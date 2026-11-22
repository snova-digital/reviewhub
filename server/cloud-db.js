// Cloud storage of the JSON part of ReviewHub in Postgres (Neon). Used by the deployed API (store-cloud.js) and by
// `rh pull` / `rh push` (scripts/cloud-sync.mjs). One row per file the local workspace would have:
//   rh_reviews     review.json             (rev-checked: an UPDATE only succeeds if the rev is unchanged)
//   rh_decisions   decisions/<rid>.json    (one row per reviewer, rev-checked the same way)
//   rh_agent_logs  agent-logs/<rid>/<file> (append-only JSONL text)
//   rh_backups     backups/                (snapshots: review + all reviewer rows, at most every 10 min, 50 kept)
//   rh_trash       trash/                  (removed reviewer rows; deleted reviews are only flagged deleted_at)
// PDFs and raw import files are kept in private Vercel Blob storage under reviews/<reviewId>/{pdfs,imports}/.
import { neon } from '@neondatabase/serverless';

const BACKUPS_KEPT = 50;
let sqlClient = null;
let schemaReady = null;

export function sql() {
  if (!sqlClient) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL is not set (connect the Neon database to the Vercel project, then `vercel env pull .env.local`).');
    sqlClient = neon(url);
  }
  return sqlClient;
}

export function ensureSchema() {
  schemaReady ||= (async () => {
    const q = sql();
    await q.transaction([
      q`create table if not exists rh_reviews (
          id text primary key, rev integer not null, doc jsonb not null,
          updated_at timestamptz not null default now(), deleted_at timestamptz)`,
      q`create table if not exists rh_decisions (
          review_id text not null, reviewer_id text not null, rev integer not null, doc jsonb not null,
          updated_at timestamptz not null default now(), primary key (review_id, reviewer_id))`,
      q`create table if not exists rh_agent_logs (
          review_id text not null, reviewer_id text not null, file text not null, body text not null,
          updated_at timestamptz not null default now(), primary key (review_id, reviewer_id, file))`,
      q`create table if not exists rh_backups (
          id bigserial primary key, review_id text not null, created_at timestamptz not null default now(), snapshot jsonb not null)`,
      q`create index if not exists rh_backups_review on rh_backups (review_id, id)`,
      q`create table if not exists rh_trash (
          id bigserial primary key, kind text not null, review_id text not null, ref text, doc jsonb, deleted_at timestamptz not null default now())`,
    ]);
  })().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

const json = (x) => JSON.stringify(x);

// Review docs without the (large) records array, plus the record count: enough for the review list.
export async function listReviewSummaries() {
  await ensureSchema();
  return sql()`select doc - 'records' as doc, coalesce(jsonb_array_length(doc->'records'), 0) as record_count
               from rh_reviews where deleted_at is null`;
}

export async function getReviewRow(id) {
  await ensureSchema();
  const [row] = await sql()`select id, rev, doc, updated_at from rh_reviews where id = ${id} and deleted_at is null`;
  return row || null;
}

export async function getDecisionRows(id) {
  await ensureSchema();
  return sql()`select reviewer_id, rev, doc from rh_decisions where review_id = ${id}`;
}

// Insert a review that does not exist yet. Returns false if the id is taken.
export async function insertReview(doc) {
  await ensureSchema();
  const rows = await sql()`insert into rh_reviews (id, rev, doc) values (${doc.id}, ${doc.rev}, ${json(doc)}::jsonb)
                           on conflict (id) do nothing returning id`;
  return rows.length > 0;
}

// Atomic compare-and-set: writes `doc` (whose rev must be expectedRev + 1) only if the stored rev is expectedRev.
export async function updateReview(id, doc, expectedRev) {
  await ensureSchema();
  const rows = await sql()`update rh_reviews set doc = ${json(doc)}::jsonb, rev = ${doc.rev}, updated_at = now()
                           where id = ${id} and rev = ${expectedRev} and deleted_at is null returning rev`;
  if (rows.length) return { ok: true };
  const [cur] = await sql()`select rev from rh_reviews where id = ${id} and deleted_at is null`;
  return { ok: false, serverRev: cur ? cur.rev : null };
}

// Same for one reviewer's decisions. expectedRev 0 = the row must not exist yet.
export async function putDecisions(id, rid, doc, expectedRev) {
  await ensureSchema();
  const rows = expectedRev === 0
    ? await sql()`insert into rh_decisions (review_id, reviewer_id, rev, doc) values (${id}, ${rid}, ${doc.rev}, ${json(doc)}::jsonb)
                  on conflict (review_id, reviewer_id) do nothing returning rev`
    : await sql()`update rh_decisions set doc = ${json(doc)}::jsonb, rev = ${doc.rev}, updated_at = now()
                  where review_id = ${id} and reviewer_id = ${rid} and rev = ${expectedRev} returning rev`;
  if (rows.length) return { ok: true };
  const [cur] = await sql()`select rev from rh_decisions where review_id = ${id} and reviewer_id = ${rid}`;
  return { ok: false, serverRev: cur ? cur.rev : 0 };
}

// Move a reviewer's row to the trash table (never hard-deleted).
export async function trashDecisions(id, rid) {
  await ensureSchema();
  const q = sql();
  await q.transaction([
    q`insert into rh_trash (kind, review_id, ref, doc) select 'decisions', review_id, reviewer_id, doc from rh_decisions
      where review_id = ${id} and reviewer_id = ${rid}`,
    q`delete from rh_decisions where review_id = ${id} and reviewer_id = ${rid}`,
  ]);
}

// Soft delete: the review is hidden, its rows stay.
export async function trashReview(id) {
  await ensureSchema();
  await sql()`update rh_reviews set deleted_at = now() where id = ${id} and deleted_at is null`;
}

export async function getAgentLogs(id, rid) {
  await ensureSchema();
  return rid
    ? sql()`select reviewer_id, file, body from rh_agent_logs where review_id = ${id} and reviewer_id = ${rid} order by file`
    : sql()`select reviewer_id, file, body from rh_agent_logs where review_id = ${id} order by reviewer_id, file`;
}

export async function putAgentLog(id, rid, file, body) {
  await ensureSchema();
  await sql()`insert into rh_agent_logs (review_id, reviewer_id, file, body) values (${id}, ${rid}, ${file}, ${body})
              on conflict (review_id, reviewer_id, file) do update set body = excluded.body, updated_at = now()`;
}

// Snapshot of review + all reviewer rows, built inside the database. Skipped if the last one is under 10 minutes old.
export async function maybeBackup(id, force = false) {
  await ensureSchema();
  const q = sql();
  await q.transaction([
    q`insert into rh_backups (review_id, snapshot)
      select r.id, r.doc || jsonb_build_object('decisions',
               (select coalesce(jsonb_object_agg(d.reviewer_id, d.doc), '{}'::jsonb) from rh_decisions d where d.review_id = r.id))
      from rh_reviews r
      where r.id = ${id} and (${force} or not exists (
        select 1 from rh_backups b where b.review_id = r.id and b.created_at > now() - interval '10 minutes'))`,
    q`delete from rh_backups where review_id = ${id} and id not in (
        select id from rh_backups where review_id = ${id} order by id desc limit ${BACKUPS_KEPT})`,
  ]);
}
