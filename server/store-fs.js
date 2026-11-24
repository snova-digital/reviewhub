// File-system storage: each review is a folder of JSON files inside the workspace (see workspace.js).
// <workspace>/reviews/<reviewId>/review.json   – shared review state (protocol, records, reviewers, consensus, codebook)
// <workspace>/reviews/<reviewId>/decisions/     – one file per reviewer (<reviewerId>.json): screening, evidence, coding
// <workspace>/reviews/<reviewId>/agent-logs/    – append-only JSONL reasoning logs of agent (LLM) reviewers
// <workspace>/reviews/<reviewId>/pdfs/          – full-text PDFs (<recordId>.pdf)
// <workspace>/reviews/<reviewId>/imports/       – raw database export files (audit trail)
// <workspace>/reviews/<reviewId>/backups/       – rolling snapshots of review.json
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG_FILE, expand, readConfig, resolveWorkspace, ROOT } from './workspace.js';
import { httpError, safeId } from './util.js';

const BACKUP_INTERVAL_MS = 10 * 60 * 1000;
const BACKUPS_KEPT = 50;

export async function writeAtomic(target, content) {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, target);
}

async function readJson(p) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') throw httpError(404, 'not found');
    throw e;
  }
}

const listIds = async (reviewsDir) => {
  try { return (await fs.readdir(reviewsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
};

// An environment variable overrides reviewhub.config.json, so a change made in the app would not survive a restart.
const envLock = () => (process.env.REVIEWHUB_WORKSPACE ? 'REVIEWHUB_WORKSPACE' : process.env.REVIEWHUB_DATA ? 'REVIEWHUB_DATA' : null);

export async function createFsStore() {
  // The workspace can be changed at runtime (PUT /api/workspace), so these are reassigned by useWorkspace().
  let WS; let DATA; let TRASH;
  const useWorkspace = (ws) => { WS = ws; DATA = ws.reviews; TRASH = ws.trash; };
  useWorkspace(resolveWorkspace());
  await fs.mkdir(DATA, { recursive: true });

  const dir = (id) => path.join(DATA, safeId(id));
  const file = (id) => path.join(dir(id), 'review.json');
  const readReview = (id) => readJson(file(id));
  const decisionsDir = (id) => path.join(dir(id), 'decisions');
  const decisionsFile = (id, rid) => path.join(decisionsDir(id), `${safeId(rid)}.json`);

  async function readAllDecisions(id) {
    const out = {};
    if (!fsSync.existsSync(decisionsDir(id))) return out;
    for (const f of await fs.readdir(decisionsDir(id))) {
      if (!f.endsWith('.json')) continue;
      try { const d = await readJson(path.join(decisionsDir(id), f)); out[d.reviewerId || f.slice(0, -5)] = d; } catch { /* skip broken */ }
    }
    return out;
  }

  // Snapshot of the full state (review.json + every reviewer file) at most every 10 minutes.
  async function maybeBackup(id, force = false) {
    const bdir = path.join(dir(id), 'backups');
    await fs.mkdir(bdir, { recursive: true });
    const existing = (await fs.readdir(bdir)).filter((f) => f.endsWith('.json')).sort();
    const last = existing.at(-1);
    if (last && !force) {
      const st = await fs.stat(path.join(bdir, last));
      if (Date.now() - st.mtimeMs < BACKUP_INTERVAL_MS) return;
    }
    if (!fsSync.existsSync(file(id))) return;
    const snapshot = { ...(await readReview(id)), decisions: await readAllDecisions(id) };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.writeFile(path.join(bdir, `review-${stamp}.json`), JSON.stringify(snapshot, null, 2));
    for (const old of existing.slice(0, Math.max(0, existing.length + 1 - BACKUPS_KEPT))) {
      await fs.rm(path.join(bdir, old), { force: true });
    }
  }

  // Schema v1 kept all decisions in review.json for a single reviewer. v2 moves them into one file per
  // reviewer so two people can screen independently without overwriting each other.
  async function migrate(id) {
    const r = await readReview(id);
    if ((r.schemaVersion || 1) >= 2) return;
    await maybeBackup(id, true);
    const hasWork = Object.keys(r.screening?.ta || {}).length || Object.keys(r.screening?.ft || {}).length || Object.keys(r.evidence || {}).length;
    const reviewers = [];
    await fs.mkdir(decisionsDir(id), { recursive: true });
    if (hasWork) {
      const rid = `rv_${crypto.randomBytes(4).toString('hex')}`;
      const name = (r.settings?.reviewer || r.protocol?.reviewers?.find((x) => x.trim()) || 'Reviewer 1').trim();
      reviewers.push({ id: rid, name, type: 'human', model: '', assignment: { ta: { mode: 'full', percent: 20 }, ft: { mode: 'full', percent: 20 }, coding: { mode: 'full', percent: 20 } }, createdAt: new Date().toISOString() });
      await writeAtomic(decisionsFile(id, rid), JSON.stringify({
        reviewerId: rid, rev: 1, updatedAt: new Date().toISOString(),
        screening: { ta: r.screening?.ta || {}, ft: r.screening?.ft || {} },
        calibration: { ta: {}, ft: {} }, calibrationArchive: [], evidence: r.evidence || {}, coding: {},
      }, null, 2));
    }
    const { screening: _s, evidence: _e, ...rest } = r;
    const next = {
      ...rest, schemaVersion: 2, reviewers, codebook: [], consensus: { ta: {}, ft: {}, coding: {} },
      settings: { calibrationSize: 20, ...(r.settings || {}) }, rev: r.rev + 1, updatedAt: new Date().toISOString(),
    };
    await writeAtomic(file(id), JSON.stringify(next, null, 2));
    console.log(`Migrated review ${id} to schema v2 (${reviewers.length} reviewer file(s) created).`);
  }

  return {
    kind: 'local',

    info: () => ({ workspace: WS.workspace, reviews: WS.reviews, source: WS.source, configurable: !envLock(), lockedBy: envLock() }),

    // Change where reviews are stored. Writes reviewhub.config.json and switches immediately.
    // copy: true copies the current workspace's reviews into the new folder (the originals stay where they are).
    async setWorkspace(rawPath, copy) {
      const lock = envLock();
      if (lock) throw httpError(409, `The workspace is set by the ${lock} environment variable. Remove it, then change the folder here.`);
      const raw = String(rawPath || '').trim();
      if (!raw) throw httpError(400, 'Enter a folder.');
      if (!raw.startsWith('~') && !path.isAbsolute(raw)) throw httpError(400, 'Use a full path, e.g. /Users/you/Research/reviewhub or ~/Research/reviewhub.');
      const target = expand(raw);
      const inside = (a, b) => { const r = path.relative(b, a); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
      if ([path.join(ROOT, 'node_modules'), path.join(ROOT, 'dist'), path.join(ROOT, 'src'), path.join(ROOT, 'server')].some((d) => inside(target, d))) {
        throw httpError(400, 'Choose a folder outside the program files.');
      }
      const next = { workspace: target, reviews: path.join(target, 'reviews'), trash: path.join(target, 'trash'), source: 'reviewhub.config.json' };
      if (path.resolve(next.reviews) === path.resolve(DATA)) return { workspace: WS.workspace, source: WS.source, copied: 0, unchanged: true };

      const ids = copy ? await listIds(DATA) : [];
      const existing = new Set(await listIds(next.reviews));
      const clash = ids.filter((id) => existing.has(id));
      if (clash.length) throw httpError(409, `The new folder already contains ${clash.length} of these reviews. Choose another folder, or switch without copying.`);

      await fs.mkdir(next.reviews, { recursive: true });
      for (const id of ids) await fs.cp(path.join(DATA, id), path.join(next.reviews, id), { recursive: true, errorOnExist: true, force: false });
      await writeAtomic(CONFIG_FILE, `${JSON.stringify({ ...readConfig(), workspace: raw }, null, 2)}\n`);
      const previous = WS.workspace;
      useWorkspace(next);
      console.log(`workspace changed: ${previous} -> ${next.workspace}${ids.length ? ` (copied ${ids.length} review(s))` : ''}`);
      return { workspace: WS.workspace, source: WS.source, previous, copied: ids.length };
    },

    async listReviews() {
      const out = [];
      for (const id of await listIds(DATA)) {
        try { out.push(await readReview(id)); } catch { /* skip broken folders */ }
      }
      return out;
    },

    async createReview(review) {
      await fs.mkdir(dir(review.id), { recursive: true });
      await writeAtomic(file(review.id), JSON.stringify(review, null, 2));
    },

    async getReview(id) {
      await migrate(id);
      return { ...(await readReview(id)), decisions: await readAllDecisions(id) };
    },

    // Optimistic concurrency: only writes when the stored rev is still `rev`.
    async saveReview(id, shared, rev) {
      const current = await readReview(id);
      if (rev !== current.rev) return { conflict: true, serverRev: current.rev };
      await maybeBackup(id);
      const next = { ...shared, id, rev: current.rev + 1, updatedAt: new Date().toISOString() };
      await writeAtomic(file(id), JSON.stringify(next, null, 2));
      return { rev: next.rev, updatedAt: next.updatedAt };
    },

    // rev 0 = file does not exist yet (new reviewer or imported file).
    async saveDecisions(id, rid, body, rev) {
      await readReview(id);
      const p = decisionsFile(id, rid);
      const currentRev = fsSync.existsSync(p) ? (await readJson(p)).rev : 0;
      if (rev !== currentRev) return { conflict: true, serverRev: currentRev };
      await maybeBackup(id);
      await fs.mkdir(decisionsDir(id), { recursive: true });
      const next = { ...body, reviewerId: rid, rev: currentRev + 1, updatedAt: new Date().toISOString() };
      await writeAtomic(p, JSON.stringify(next, null, 2));
      return { rev: next.rev, updatedAt: next.updatedAt };
    },

    // Snapshot now, regardless of the 10-minute interval (before a restart of the review, for example).
    async backup(id) {
      await readReview(id);
      await maybeBackup(id, true);
    },

    // Removing a reviewer moves their file to <workspace>/trash (never hard-deleted).
    async trashDecisions(id, rid) {
      const p = decisionsFile(id, rid);
      if (!fsSync.existsSync(p)) return;
      await maybeBackup(id, true);
      await fs.mkdir(TRASH, { recursive: true });
      await fs.rename(p, path.join(TRASH, `${safeId(id)}-${safeId(rid)}-${Date.now()}.json`));
    },

    // Soft delete: move folder to <workspace>/trash so nothing is ever lost by accident.
    async trashReview(id) {
      await fs.mkdir(TRASH, { recursive: true });
      await fs.rename(dir(id), path.join(TRASH, `${safeId(id)}-${Date.now()}`));
    },

    // <review>/agent-logs/<reviewerId>/<runId>.jsonl → [{ file, text }]
    async agentLogFiles(id, rid) {
      const ldir = path.join(dir(id), 'agent-logs', safeId(rid));
      if (!fsSync.existsSync(ldir)) return [];
      const out = [];
      for (const f of (await fs.readdir(ldir)).filter((x) => x.endsWith('.jsonl')).sort()) {
        out.push({ file: f, text: await fs.readFile(path.join(ldir, f), 'utf8') });
      }
      return out;
    },

    // ---- files (PDFs and raw import files) ----
    async putFile(id, kind, name, buffer) {
      const d = path.join(dir(id), kind);
      await fs.mkdir(d, { recursive: true });
      await fs.writeFile(path.join(d, path.basename(name)), buffer);
    },
    // Express response handler for a stored file.
    async sendFile(res, id, kind, name, { download = false, type } = {}) {
      const p = path.join(dir(id), kind, path.basename(name));
      if (!fsSync.existsSync(p)) return res.status(404).end();
      if (download) return res.download(p);
      if (type) res.type(type);
      return res.sendFile(p);
    },
    async deleteFile(id, kind, name) {
      await fs.rm(path.join(dir(id), kind, path.basename(name)), { force: true });
    },
  };
}
