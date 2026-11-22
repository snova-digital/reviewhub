// ReviewHub local API: persists each review as a JSON file on disk, inside the workspace (see workspace.js).
// <workspace>/reviews/<reviewId>/review.json   – shared review state (protocol, records, reviewers, consensus, codebook)
// <workspace>/reviews/<reviewId>/decisions/     – one file per reviewer (<reviewerId>.json): screening, evidence, coding
// <workspace>/reviews/<reviewId>/agent-logs/    – append-only JSONL reasoning logs of agent (LLM) reviewers
// <workspace>/reviews/<reviewId>/pdfs/          – full-text PDFs (<recordId>.pdf)
// <workspace>/reviews/<reviewId>/imports/       – raw database export files (audit trail)
// <workspace>/reviews/<reviewId>/backups/       – rolling snapshots of review.json
import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG_FILE, expand, readConfig, resolveWorkspace, ROOT } from './workspace.js';

// The workspace can be changed at runtime (PUT /api/workspace), so these are reassigned by useWorkspace().
let WS;
let DATA;
let TRASH;
function useWorkspace(ws) { WS = ws; DATA = ws.reviews; TRASH = ws.trash; }
useWorkspace(resolveWorkspace());
const PORT = Number(process.env.PORT || 5288);
// Local tool without logins: only reachable from this computer unless HOST is set explicitly (e.g. HOST=0.0.0.0).
const HOST = process.env.HOST || '127.0.0.1';
const BACKUP_INTERVAL_MS = 10 * 60 * 1000;
const BACKUPS_KEPT = 50;

await fs.mkdir(DATA, { recursive: true });

const app = express();
app.use(express.json({ limit: '200mb' }));

const safeId = (id) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw Object.assign(new Error('bad id'), { status: 400 });
  return id;
};
const dir = (id) => path.join(DATA, safeId(id));
const file = (id) => path.join(dir(id), 'review.json');

async function readJson(p) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') throw Object.assign(new Error('not found'), { status: 404 });
    throw e;
  }
}
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

async function writeAtomic(target, content) {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, target);
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

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- workspace -------------------------------------------------------------
const VERSION = JSON.parse(fsSync.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
// An environment variable overrides reviewhub.config.json, so a change made in the app would not survive a restart.
const envLock = () => (process.env.REVIEWHUB_WORKSPACE ? 'REVIEWHUB_WORKSPACE' : process.env.REVIEWHUB_DATA ? 'REVIEWHUB_DATA' : null);
app.get('/api/info', (_req, res) => res.json({ version: VERSION, workspace: WS.workspace, reviews: WS.reviews, source: WS.source, configurable: !envLock(), lockedBy: envLock() }));

const listIds = async (reviewsDir) => {
  try { return (await fs.readdir(reviewsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
};

// Change where reviews are stored. Body: { path, copy }. Writes reviewhub.config.json and switches immediately.
// copy: true copies the current workspace's reviews into the new folder (the originals stay where they are).
app.put('/api/workspace', wrap(async (req, res) => {
  const lock = envLock();
  if (lock) throw Object.assign(new Error(`The workspace is set by the ${lock} environment variable. Remove it, then change the folder here.`), { status: 409 });
  const raw = String(req.body?.path || '').trim();
  if (!raw) throw Object.assign(new Error('Enter a folder.'), { status: 400 });
  if (!raw.startsWith('~') && !path.isAbsolute(raw)) throw Object.assign(new Error('Use a full path, e.g. /Users/you/Research/reviewhub or ~/Research/reviewhub.'), { status: 400 });
  const target = expand(raw);
  const inside = (a, b) => { const r = path.relative(b, a); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
  if ([path.join(ROOT, 'node_modules'), path.join(ROOT, 'dist'), path.join(ROOT, 'src'), path.join(ROOT, 'server')].some((d) => inside(target, d))) {
    throw Object.assign(new Error('Choose a folder outside the program files.'), { status: 400 });
  }
  const next = { workspace: target, reviews: path.join(target, 'reviews'), trash: path.join(target, 'trash'), source: 'reviewhub.config.json' };
  if (path.resolve(next.reviews) === path.resolve(DATA)) return res.json({ workspace: WS.workspace, source: WS.source, copied: 0, unchanged: true });

  const ids = req.body?.copy ? await listIds(DATA) : [];
  const existing = new Set(await listIds(next.reviews));
  const clash = ids.filter((id) => existing.has(id));
  if (clash.length) throw Object.assign(new Error(`The new folder already contains ${clash.length} of these reviews. Choose another folder, or switch without copying.`), { status: 409 });

  await fs.mkdir(next.reviews, { recursive: true });
  for (const id of ids) await fs.cp(path.join(DATA, id), path.join(next.reviews, id), { recursive: true, errorOnExist: true, force: false });
  await writeAtomic(CONFIG_FILE, `${JSON.stringify({ ...readConfig(), workspace: raw }, null, 2)}\n`);
  const previous = WS.workspace;
  useWorkspace(next);
  console.log(`workspace changed: ${previous} -> ${next.workspace}${ids.length ? ` (copied ${ids.length} review(s))` : ''}`);
  res.json({ workspace: WS.workspace, source: WS.source, previous, copied: ids.length });
}));

// ---- reviews ---------------------------------------------------------------
app.get('/api/reviews', wrap(async (_req, res) => {
  const ids = (await fs.readdir(DATA, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  const out = [];
  for (const id of ids) {
    try {
      const r = await readReview(id);
      out.push({
        id: r.id, title: r.title, type: r.type, createdAt: r.createdAt, updatedAt: r.updatedAt,
        records: r.records?.length ?? 0, runs: r.runs?.length ?? 0,
        reviewers: (r.reviewers || []).map((rv) => ({ id: rv.id, name: rv.name, type: rv.type })),
      });
    } catch { /* skip broken folders */ }
  }
  out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  res.json(out);
}));

app.post('/api/reviews', wrap(async (req, res) => {
  const id = `rev_${crypto.randomBytes(5).toString('hex')}`;
  const now = new Date().toISOString();
  const review = { ...req.body, id, rev: 1, createdAt: now, updatedAt: now };
  await fs.mkdir(dir(id), { recursive: true });
  await writeAtomic(file(id), JSON.stringify(review, null, 2));
  res.status(201).json(review);
}));

// Returns the shared review plus every reviewer's decision file under `decisions`.
app.get('/api/reviews/:id', wrap(async (req, res) => {
  await migrate(req.params.id);
  res.json({ ...(await readReview(req.params.id)), decisions: await readAllDecisions(req.params.id) });
}));

// Full-document save with optimistic concurrency (prevents two tabs overwriting each other).
app.put('/api/reviews/:id', wrap(async (req, res) => {
  const id = req.params.id;
  const current = await readReview(id);
  if (req.body.rev !== current.rev) {
    return res.status(409).json({ error: 'conflict', serverRev: current.rev });
  }
  await maybeBackup(id);
  const { decisions: _d, ...shared } = req.body;
  const next = { ...shared, id, rev: current.rev + 1, updatedAt: new Date().toISOString() };
  await writeAtomic(file(id), JSON.stringify(next, null, 2));
  res.json({ rev: next.rev, updatedAt: next.updatedAt });
}));

// One reviewer's decisions. rev 0 = file does not exist yet (new reviewer or imported file).
app.put('/api/reviews/:id/decisions/:rid', wrap(async (req, res) => {
  const { id, rid } = req.params;
  await readReview(id);
  const p = decisionsFile(id, rid);
  const currentRev = fsSync.existsSync(p) ? (await readJson(p)).rev : 0;
  if ((req.body.rev || 0) !== currentRev) return res.status(409).json({ error: 'conflict', serverRev: currentRev });
  await maybeBackup(id);
  await fs.mkdir(decisionsDir(id), { recursive: true });
  const next = { ...req.body, reviewerId: rid, rev: currentRev + 1, updatedAt: new Date().toISOString() };
  await writeAtomic(p, JSON.stringify(next, null, 2));
  res.json({ rev: next.rev, updatedAt: next.updatedAt });
}));

// Removing a reviewer moves their file to <workspace>/trash (never hard-deleted).
app.delete('/api/reviews/:id/decisions/:rid', wrap(async (req, res) => {
  const p = decisionsFile(req.params.id, req.params.rid);
  if (fsSync.existsSync(p)) {
    await maybeBackup(req.params.id, true);
    await fs.mkdir(TRASH, { recursive: true });
    await fs.rename(p, path.join(TRASH, `${req.params.id}-${req.params.rid}-${Date.now()}.json`));
  }
  res.status(204).end();
}));

app.delete('/api/reviews/:id', wrap(async (req, res) => {
  // Soft delete: move folder to <workspace>/trash so nothing is ever lost by accident.
  await fs.mkdir(TRASH, { recursive: true });
  await fs.rename(dir(req.params.id), path.join(TRASH, `${req.params.id}-${Date.now()}`));
  res.status(204).end();
}));

// ---- agent reasoning logs ----------------------------------------------------
// <review>/agent-logs/<reviewerId>/<runId>.jsonl, written append-only by agent reviewers (see CLAUDE.md).
// Returned parsed, so the UI can show how an agent arrived at a decision.
app.get('/api/reviews/:id/agent-logs/:rid', wrap(async (req, res) => {
  const ldir = path.join(dir(req.params.id), 'agent-logs', safeId(req.params.rid));
  if (!fsSync.existsSync(ldir)) return res.json([]);
  const runs = [];
  for (const f of (await fs.readdir(ldir)).filter((x) => x.endsWith('.jsonl')).sort()) {
    const lines = (await fs.readFile(path.join(ldir, f), 'utf8')).split('\n').filter((l) => l.trim());
    const entries = [];
    for (const l of lines) { try { entries.push(JSON.parse(l)); } catch { entries.push({ type: 'unparseable', raw: l.slice(0, 200) }); } }
    runs.push({ file: f, header: entries.find((e) => e.type === 'run') || null, entries: entries.filter((e) => e.type !== 'run') });
  }
  res.json(runs);
}));

// ---- files -----------------------------------------------------------------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024 * 1024 } });

// Raw export files from database searches (kept verbatim for reproducibility).
app.post('/api/reviews/:id/imports', upload.single('file'), wrap(async (req, res) => {
  const idir = path.join(dir(req.params.id), 'imports');
  await fs.mkdir(idir, { recursive: true });
  const clean = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storedAs = `${Date.now()}-${clean}`;
  await fs.writeFile(path.join(idir, storedAs), req.file.buffer);
  res.status(201).json({ storedAs, size: req.file.size });
}));

app.get('/api/reviews/:id/imports/:name', wrap(async (req, res) => {
  const name = path.basename(req.params.name);
  res.download(path.join(dir(req.params.id), 'imports', name));
}));

app.post('/api/reviews/:id/pdfs/:recordId', upload.single('file'), wrap(async (req, res) => {
  const pdir = path.join(dir(req.params.id), 'pdfs');
  await fs.mkdir(pdir, { recursive: true });
  const head = req.file.buffer.subarray(0, 5).toString();
  if (head !== '%PDF-') return res.status(400).json({ error: 'not a PDF' });
  const storedAs = `${safeId(req.params.recordId)}.pdf`;
  await fs.writeFile(path.join(pdir, storedAs), req.file.buffer);
  res.status(201).json({ storedAs, size: req.file.size, originalName: req.file.originalname });
}));

app.get('/api/reviews/:id/pdfs/:recordId', wrap(async (req, res) => {
  const p = path.join(dir(req.params.id), 'pdfs', `${safeId(req.params.recordId)}.pdf`);
  if (!fsSync.existsSync(p)) return res.status(404).end();
  res.type('application/pdf').sendFile(p);
}));

app.delete('/api/reviews/:id/pdfs/:recordId', wrap(async (req, res) => {
  const p = path.join(dir(req.params.id), 'pdfs', `${safeId(req.params.recordId)}.pdf`);
  await fs.rm(p, { force: true });
  res.status(204).end();
}));

// ---- production static -----------------------------------------------------
const dist = path.join(ROOT, 'dist');
if (fsSync.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message });
});

app.listen(PORT, HOST, () => console.log(`ReviewHub API on http://${HOST}:${PORT}\n  workspace: ${WS.workspace}  [${WS.source}]`))
  .on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\nPort ${PORT} is already in use: ReviewHub is probably already running in another terminal.\nStop it there, or find the process with:  lsof -nP -iTCP:${PORT} -sTCP:LISTEN\n`);
      process.exit(1);
    }
    throw e;
  });
