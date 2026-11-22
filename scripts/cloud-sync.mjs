// `rh cloud-list | pull | push`: copy a review between the hosted ReviewHub (Neon + Vercel Blob) and the local workspace,
// so you can work on it locally (the app, or Claude Code as an agent reviewer) and upload the result.
//
// Needs DATABASE_URL and BLOB_READ_WRITE_TOKEN, normally from .env.local (`vercel env pull .env.local`).
//
// Safety rules (same spirit as the rest of ReviewHub: nothing is silently overwritten):
// - pull refuses to overwrite local changes that were not pushed yet (unless --force) and always snapshots the local
//   copy to <review>/backups/ first. Reviewer files that no longer exist online go to <workspace>/trash/.
// - push only writes what changed locally since the last pull/push, and each part only if it is unchanged online since
//   then (rev check, the same rule the web app uses). Every reviewer has their own decisions, so your decisions never
//   clash with your co-reviewer's; review.json (protocol, criteria, reviewers, consensus, …) is shared and can.
// - Sync state per review is kept in <review>/.cloud-sync.json (the revs last seen online).
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ROOT } from '../server/workspace.js';

const SYNC_FILE = '.cloud-sync.json';
const FILE_KINDS = ['pdfs', 'imports'];

function loadEnv() {
  const p = path.join(ROOT, '.env.local');
  if (fs.existsSync(p)) process.loadEnvFile(p);
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    throw new Error('DATABASE_URL is not set. In this folder run:  vercel env pull .env.local');
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN is not set. In this folder run:  vercel env pull .env.local');
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

// ---- local side ---------------------------------------------------------------------------------
function local(ws, id) {
  const dir = path.join(ws.reviews, id);
  const has = fs.existsSync(path.join(dir, 'review.json'));
  const review = has ? readJson(path.join(dir, 'review.json')) : null;
  const decisions = {};
  const ddir = path.join(dir, 'decisions');
  if (fs.existsSync(ddir)) {
    for (const f of fs.readdirSync(ddir).filter((x) => x.endsWith('.json'))) {
      const d = readJson(path.join(ddir, f));
      decisions[d.reviewerId || f.slice(0, -5)] = { ...d, _file: path.join(ddir, f) };
    }
  }
  const logs = [];
  const ldir = path.join(dir, 'agent-logs');
  if (fs.existsSync(ldir)) {
    for (const rid of fs.readdirSync(ldir)) {
      if (!fs.statSync(path.join(ldir, rid)).isDirectory()) continue;
      for (const f of fs.readdirSync(path.join(ldir, rid)).filter((x) => x.endsWith('.jsonl'))) {
        logs.push({ rid, file: f, text: fs.readFileSync(path.join(ldir, rid, f), 'utf8') });
      }
    }
  }
  const syncPath = path.join(dir, SYNC_FILE);
  const sync = fs.existsSync(syncPath) ? readJson(syncPath) : null;
  return { dir, has, review, decisions, logs, sync, syncPath };
}

// What changed locally since the last sync (empty list = nothing to push).
function localChanges(l) {
  if (!l.has) return [];
  if (!l.sync) return ['the whole review (never synced with the hosted version)'];
  const out = [];
  if (l.review.rev !== l.sync.review) out.push('review.json (shared review state)');
  for (const [rid, d] of Object.entries(l.decisions)) if (d.rev !== l.sync.decisions?.[rid]) out.push(`decisions of ${rid}`);
  for (const rid of Object.keys(l.sync.decisions || {})) if (!l.decisions[rid]) out.push(`removal of reviewer file ${rid}`);
  for (const g of l.logs) if ((l.sync.logs?.[`${g.rid}/${g.file}`] ?? -1) !== g.text.length) out.push(`agent log ${g.rid}/${g.file}`);
  return out;
}

function snapshotLocal(l, why) {
  const bdir = path.join(l.dir, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const decisions = Object.fromEntries(Object.entries(l.decisions).map(([k, { _file, ...d }]) => [k, d]));
  const p = path.join(bdir, `review-${stamp()}-${why}.json`);
  fs.writeFileSync(p, JSON.stringify({ ...l.review, decisions }, null, 2));
  return p;
}

// ---- cloud files (Blob) -----------------------------------------------------------------------
async function listBlobs(id) {
  const { list } = await import('@vercel/blob');
  const out = new Map();
  let cursor;
  do {
    const page = await list({ prefix: `reviews/${id}/`, cursor, limit: 1000 });
    for (const b of page.blobs) out.set(b.pathname, b.size);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function uploadFiles(l, id, log) {
  const { put } = await import('@vercel/blob');
  const online = await listBlobs(id);
  let n = 0;
  for (const kind of FILE_KINDS) {
    const d = path.join(l.dir, kind);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (!fs.statSync(p).isFile()) continue;
      const key = `reviews/${id}/${kind}/${f}`;
      if (online.get(key) === fs.statSync(p).size) continue;
      await put(key, fs.readFileSync(p), {
        access: 'private', allowOverwrite: true, addRandomSuffix: false,
        contentType: kind === 'pdfs' ? 'application/pdf' : 'application/octet-stream',
        multipart: fs.statSync(p).size > 8 * 1024 * 1024,
      });
      n += 1;
      log(`  uploaded ${kind}/${f}`);
    }
  }
  return n;
}

async function downloadFiles(l, id, log) {
  const { get } = await import('@vercel/blob');
  let n = 0;
  for (const [key, size] of await listBlobs(id)) {
    const [, , kind, ...rest] = key.split('/');
    if (!FILE_KINDS.includes(kind) || !rest.length) continue;
    const target = path.join(l.dir, kind, path.basename(rest.join('/')));
    if (fs.existsSync(target) && fs.statSync(target).size === size) continue;
    const res = await get(key, { access: 'private', useCache: false });
    if (!res?.stream) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    await pipeline(res.stream instanceof Readable ? res.stream : Readable.fromWeb(res.stream), fs.createWriteStream(tmp));
    fs.renameSync(tmp, target);
    n += 1;
    log(`  downloaded ${kind}/${path.basename(target)}`);
  }
  return n;
}

// ---- commands -----------------------------------------------------------------------------------
async function findCloudReview(db, q) {
  if (!q) throw new Error('missing <review> (id or part of the title; see `rh cloud-list`)');
  const all = (await db.listReviewSummaries()).map((r) => r.doc);
  const exact = all.find((r) => r.id === q);
  if (exact) return exact.id;
  const hits = all.filter((r) => (r.title || '').toLowerCase().includes(String(q).toLowerCase()));
  if (hits.length === 1) return hits[0].id;
  throw new Error(hits.length ? `"${q}" matches ${hits.length} online reviews: ${hits.map((r) => r.id).join(', ')}` : `no online review matches "${q}" (see \`rh cloud-list\`)`);
}

export async function cloudList() {
  loadEnv();
  const db = await import('../server/cloud-db.js');
  const rows = await db.listReviewSummaries();
  return rows.map((r) => ({ id: r.doc.id, title: r.doc.title, rev: r.doc.rev, records: r.record_count, updatedAt: r.doc.updatedAt }))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function pull(ws, q, { force = false, log = console.error } = {}) {
  loadEnv();
  const db = await import('../server/cloud-db.js');
  const id = await findCloudReview(db, q);
  const row = await db.getReviewRow(id);
  const l = local(ws, id);

  let backup = null;
  if (l.has) {
    const changes = localChanges(l);
    if (changes.length && !force) {
      throw new Error(`your local copy has changes that are not online yet:\n  - ${changes.join('\n  - ')}\n`
        + 'Run `rh push` first, or `rh pull --force` to replace them (a snapshot is kept in the review\'s backups/ folder).');
    }
    backup = snapshotLocal(l, 'before-pull');
  }

  const dec = await db.getDecisionRows(id);
  const logs = await db.getAgentLogs(id);
  writeJson(path.join(l.dir, 'review.json'), { ...row.doc, rev: row.rev });
  const online = new Set(dec.map((d) => d.reviewer_id));
  for (const d of dec) writeJson(path.join(l.dir, 'decisions', `${d.reviewer_id}.json`), { ...d.doc, rev: d.rev });
  for (const [rid, d] of Object.entries(l.decisions)) {
    if (online.has(rid)) continue;
    fs.mkdirSync(ws.trash, { recursive: true });
    fs.renameSync(d._file, path.join(ws.trash, `${id}-${rid}-${Date.now()}.json`));
    log(`  reviewer file ${rid} is not online any more: moved to trash`);
  }
  for (const g of logs) {
    const p = path.join(l.dir, 'agent-logs', g.reviewer_id, g.file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, g.body);
  }
  const files = await downloadFiles(l, id, log);

  writeJson(l.syncPath, {
    review: row.rev,
    decisions: Object.fromEntries(dec.map((d) => [d.reviewer_id, d.rev])),
    logs: Object.fromEntries(logs.map((g) => [`${g.reviewer_id}/${g.file}`, g.body.length])),
    pulledAt: new Date().toISOString(),
  });
  return { id, title: row.doc.title, rev: row.rev, reviewers: dec.length, agentLogs: logs.length, filesDownloaded: files, localBackup: backup, folder: l.dir };
}

export async function push(ws, id, { log = console.error } = {}) {
  loadEnv();
  const db = await import('../server/cloud-db.js');
  const l = local(ws, id);
  if (!l.has) throw new Error(`no local review ${id}`);
  if ((l.review.schemaVersion || 1) < 2) throw new Error('this review uses schema v1: open it once in the local app so it is migrated, then push');
  const row = await db.getReviewRow(id);
  const conflicts = [];
  const pushed = [];

  if (!l.sync) {
    // First upload of a review that only exists locally.
    if (row) throw new Error(`${id} already exists online. Run \`rh pull ${id}\` first (your local copy is snapshotted to backups/), then redo or re-push your changes.`);
    if (!(await db.insertReview({ ...l.review, id }))) throw new Error(`${id} already exists online`);
    pushed.push('review.json (new)');
    for (const [rid, { _file, ...d }] of Object.entries(l.decisions)) {
      const res = await db.putDecisions(id, rid, { ...d, reviewerId: rid }, 0);
      if (res.ok) pushed.push(`decisions of ${rid}`); else conflicts.push(`decisions of ${rid}: already online`);
    }
    l.sync = { review: l.review.rev, decisions: Object.fromEntries(Object.entries(l.decisions).map(([k, d]) => [k, d.rev])), logs: {} };
  } else {
    if (!row) throw new Error(`${id} is not online (any more). If it was deleted in the web app, it is in the database's trash; nothing was changed.`);
    await db.maybeBackup(id, true);

    // Each reviewer's own decisions first: these never clash with someone else's work.
    for (const [rid, d] of Object.entries(l.decisions)) {
      const base = l.sync.decisions?.[rid] ?? 0;
      if (d.rev === base) continue;
      const { _file, ...doc } = d;
      const next = { ...doc, reviewerId: rid, rev: base + 1, updatedAt: new Date().toISOString() };
      const res = await db.putDecisions(id, rid, next, base);
      if (!res.ok) { conflicts.push(`decisions of ${rid}: changed online since your last pull (online rev ${res.serverRev}, yours based on ${base})`); continue; }
      writeJson(_file, next);
      l.sync.decisions = { ...l.sync.decisions, [rid]: next.rev };
      pushed.push(`decisions of ${rid}`);
    }
    for (const rid of Object.keys(l.sync.decisions || {})) {
      if (l.decisions[rid]) continue;
      const online = (await db.getDecisionRows(id)).find((d) => d.reviewer_id === rid);
      if (online && online.rev !== l.sync.decisions[rid]) { conflicts.push(`removal of ${rid}: their decisions changed online, so they were kept`); continue; }
      if (online) await db.trashDecisions(id, rid);
      const { [rid]: _x, ...restDec } = l.sync.decisions;
      l.sync.decisions = restDec;
      pushed.push(`removal of reviewer file ${rid}`);
    }

    // The shared review state.
    if (l.review.rev !== l.sync.review) {
      const next = { ...l.review, id, rev: l.sync.review + 1, updatedAt: new Date().toISOString() };
      const res = await db.updateReview(id, next, l.sync.review);
      if (res.ok) {
        writeJson(path.join(l.dir, 'review.json'), next);
        l.sync.review = next.rev;
        pushed.push('review.json (shared review state)');
      } else {
        conflicts.push(`review.json: the shared review state was changed online since your last pull (online rev ${res.serverRev}, yours based on ${l.sync.review}). `
          + 'It was NOT uploaded. Run `rh pull --force` to get the online version (your local copy is snapshotted to backups/) and redo the shared changes.');
      }
    }
  }

  // Agent logs are append-only: upload new files and appended lines.
  const onlineLogs = new Map((await db.getAgentLogs(id)).map((g) => [`${g.reviewer_id}/${g.file}`, g.body]));
  for (const g of l.logs) {
    const key = `${g.rid}/${g.file}`;
    const cur = onlineLogs.get(key);
    if (cur === g.text) { l.sync.logs = { ...l.sync.logs, [key]: g.text.length }; continue; }
    if (cur !== undefined && !g.text.startsWith(cur)) { conflicts.push(`agent log ${key}: differs online and is not an extension of it; left unchanged`); continue; }
    await db.putAgentLog(id, g.rid, g.file, g.text);
    l.sync.logs = { ...l.sync.logs, [key]: g.text.length };
    pushed.push(`agent log ${key}`);
  }

  const files = await uploadFiles(l, id, log);
  writeJson(l.syncPath, { ...l.sync, pushedAt: new Date().toISOString() });
  return { id, title: l.review.title, pushed, filesUploaded: files, conflicts };
}
