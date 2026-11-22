#!/usr/bin/env node
// ReviewHub command-line helper for agent reviewers (e.g. Claude Code running in this folder) and scripting.
// Works directly on the workspace files, the same way the API does: atomic writes, rev bumps, backups.
// An agent only ever writes ITS OWN decision file plus its append-only reasoning log; shared changes (codebook,
// reviewers) bump review.json's rev, so an open browser tab reports "Changed elsewhere" and can reload.
//
// Usage: node scripts/rh.mjs <command> [args]      (run `node scripts/rh.mjs help`)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveWorkspace, ROOT } from '../server/workspace.js';
import {
  calibrationSet, codebookLogEntry, codingPool, criteriaFor, criteriaHash, criterionCode, decisionsOf, emptyDecisions,
  ftPool, isAssigned, newCode, newReviewer, uniqueRecords,
} from '../src/lib/model.js';
import { frameworkElements, frameworkValues, profileOf, reviewSettings } from '../src/lib/methods.js';
import { prismaCounts } from '../src/lib/prisma.js';
import { buildPaperData } from '../src/lib/paperData.js';

const WS = resolveWorkspace();
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const BACKUP_INTERVAL_MS = 10 * 60 * 1000;

// ---- args ---------------------------------------------------------------------------------------
const [cmd, ...rest] = process.argv.slice(2);
const pos = []; const opt = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) { const k = rest[i].slice(2); const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; opt[k] = v; } else pos.push(rest[i]);
}
const die = (msg) => { console.error(`rh: ${msg}`); process.exit(1); };
const out = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));

// ---- files --------------------------------------------------------------------------------------
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
function writeAtomic(target, obj) {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, target);
}
const reviewDir = (id) => path.join(WS.reviews, id);
const listReviews = () => (fs.existsSync(WS.reviews) ? fs.readdirSync(WS.reviews, { withFileTypes: true }) : [])
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(WS.reviews, d.name, 'review.json')))
  .map((d) => readJson(path.join(WS.reviews, d.name, 'review.json')));

function findReview(q) {
  if (!q) die('missing <review> (id or part of the title; see `rh list`)');
  const all = listReviews();
  const hit = all.find((r) => r.id === q) || all.filter((r) => r.title.toLowerCase().includes(String(q).toLowerCase()));
  if (Array.isArray(hit)) {
    if (hit.length === 1) return hit[0].id;
    die(hit.length ? `"${q}" matches ${hit.length} reviews: ${hit.map((r) => r.id).join(', ')}` : `no review matches "${q}"`);
  }
  return hit.id;
}

function loadReview(id) {
  const r = readJson(path.join(reviewDir(id), 'review.json'));
  if ((r.schemaVersion || 1) < 2) die('this review uses schema v1: open it once in the app so it is migrated');
  r.decisions = {};
  const ddir = path.join(reviewDir(id), 'decisions');
  if (fs.existsSync(ddir)) for (const f of fs.readdirSync(ddir).filter((x) => x.endsWith('.json'))) { const d = readJson(path.join(ddir, f)); r.decisions[d.reviewerId || f.slice(0, -5)] = d; }
  return r;
}

function backup(id) {
  const bdir = path.join(reviewDir(id), 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const last = fs.readdirSync(bdir).filter((f) => f.endsWith('.json')).sort().at(-1);
  if (last && Date.now() - fs.statSync(path.join(bdir, last)).mtimeMs < BACKUP_INTERVAL_MS) return;
  const snap = loadReview(id);
  fs.writeFileSync(path.join(bdir, `review-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify(snap, null, 2));
}

// Shared review.json: re-read, apply, bump rev (an open browser tab then sees a conflict and reloads).
function saveShared(id, fn) {
  backup(id);
  const p = path.join(reviewDir(id), 'review.json');
  const cur = readJson(p);
  const next = fn(cur);
  writeAtomic(p, { ...next, id, rev: cur.rev + 1, updatedAt: new Date().toISOString() });
}

// One reviewer's own decision file.
function saveDecisions(id, rid, fn) {
  backup(id);
  const ddir = path.join(reviewDir(id), 'decisions');
  fs.mkdirSync(ddir, { recursive: true });
  const p = path.join(ddir, `${rid}.json`);
  const cur = fs.existsSync(p) ? readJson(p) : emptyDecisions(rid);
  const next = fn(cur);
  writeAtomic(p, { ...next, reviewerId: rid, rev: (cur.rev || 0) + 1, updatedAt: new Date().toISOString() });
}

function appendLog(id, rid, runId, entries) {
  const ldir = path.join(reviewDir(id), 'agent-logs', rid);
  fs.mkdirSync(ldir, { recursive: true });
  const p = path.join(ldir, `${runId}.jsonl`);
  fs.appendFileSync(p, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return p;
}

const readJsonl = (file) => {
  if (!file || file === true) die('missing --file <path.jsonl>');
  return fs.readFileSync(file, 'utf8').split('\n').map((l, i) => [l.trim(), i + 1]).filter(([l]) => l)
    .map(([l, n]) => { try { return JSON.parse(l); } catch (e) { return die(`${file}:${n}: invalid JSON (${e.message})`); } });
};

function reviewerOf(review, q) {
  if (!q || q === true) die(`missing --reviewer <id or name>. Reviewers: ${review.reviewers.map((r) => `${r.id} (${r.name})`).join(', ') || 'none'}`);
  const rv = review.reviewers.find((r) => r.id === q) || review.reviewers.find((r) => r.name.toLowerCase() === String(q).toLowerCase());
  if (!rv) die(`no reviewer "${q}"`);
  return rv;
}
const runIdNow = () => `run_${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')}_${crypto.randomBytes(2).toString('hex')}`;
const pdfPath = (id, r) => { const p = path.join(reviewDir(id), 'pdfs', `${r.id}.pdf`); return fs.existsSync(p) ? p : null; };

// ---- commands -----------------------------------------------------------------------------------
const commands = {
  help() {
    out(`ReviewHub CLI (workspace: ${WS.workspace}  [${WS.source}])

  info                                   workspace location and reviews
  list                                   reviews (id, title, type, counts)
  show <review>                          protocol, framework, criteria (with codes and fingerprints), reviewers,
                                         codebook, charting form, progress: everything an agent reviewer needs
  add-reviewer <review> --name <name> [--model <model/setup>] [--human]
                                         register a reviewer (LLM by default); prints its id
  pool <review> --reviewer <r> --stage ta|ft|coding [--scope calibration] [--all] [--limit n]
                                         records to work on, as JSONL (pending ones only unless --all)
  decide <review> --reviewer <r> --stage ta|ft --file decisions.jsonl [--scope calibration]
         [--model <m>] [--prompt-version <v>] [--dry-run]
                                         record screening decisions + reasoning log (format: CLAUDE.md)
  code <review> --reviewer <r> --file coding.jsonl [--model <m>] [--prompt-version <v>] [--dry-run]
                                         record codes, charting values and excerpts + reasoning log
  codebook <review> --import codebook.json [--by <name>]
                                         add codes (definitions, rules, origin) to the shared codebook
  paper <review> [--out <file>]          write the paper data JSON (final values for all figures and tables)
                                         to <review>/exports/paper-data.json

Hosted version (Neon + Vercel Blob; needs .env.local from \`vercel env pull .env.local\`, see docs/HOSTING.md):
  cloud-list                             reviews stored online
  pull <review> [--force]                copy an online review into the local workspace (refuses to replace
                                         unpushed local changes unless --force; always snapshots to backups/)
  push <review>                          upload local changes: your decisions, agent logs, PDFs/imports, and
                                         review.json if nobody changed it online since your last pull

<review> is a review id or a unique part of its title; <r> is a reviewer id or name.`);
  },

  info() {
    out({ version: VERSION, workspace: WS.workspace, source: WS.source, reviews: listReviews().map((r) => ({ id: r.id, title: r.title })) });
  },

  list() {
    out(listReviews().map((r) => ({ id: r.id, title: r.title, type: r.type, records: r.records?.length ?? 0, reviewers: (r.reviewers || []).map((x) => `${x.name} (${x.type})`), updatedAt: r.updatedAt })));
  },

  show() {
    const id = findReview(pos[0]);
    const r = loadReview(id);
    const s = reviewSettings(r);
    const p = profileOf(r);
    const c = prismaCounts(r);
    const values = frameworkValues(r);
    const crit = (stage) => criteriaFor(r, stage).map((x) => ({ code: criterionCode(r, x.id), kind: x.kind, element: x.element, group: x.group || null, text: x.text }));
    out({
      id, title: r.title, type: r.type, methodology: p.methodology, guideline: p.guideline, folder: reviewDir(id),
      protocol: {
        objective: r.protocol.objective, questions: r.protocol.questions.filter((q) => q.trim()),
        framework: s.framework, elements: Object.fromEntries(frameworkElements(r).map(([k, label]) => [label, values[k] || ''])),
        evidenceSources: r.protocol.evidenceSources, notes: r.protocol.notes,
      },
      criteria: { ta: crit('ta'), ft: crit('ft') },
      criteriaHash: { ta: criteriaHash(r, 'ta'), ft: criteriaHash(r, 'ft') },
      decisionRules: {
        ta: 'decision: include | unclear (= review with full text) | exclude. Exclusion criteria met → exclude. Ambiguous → unclear.',
        ft: 'decision: include | exclude | not_retrieved. Exclude requires "reason" = code of the primary exclusion criterion.',
        groups: 'Inclusion criteria sharing a group: at least one of the group must be met; ungrouped inclusion criteria must all be met.',
      },
      reviewers: r.reviewers.map((x) => ({ id: x.id, name: x.name, type: x.type, model: x.model, assignment: x.assignment })),
      codebook: r.codebook.map((x) => ({ id: x.id, group: x.group, label: x.label, definition: x.description, whenToUse: x.whenToUse, whenNotToUse: x.whenNotToUse, origin: x.origin })),
      chartingForm: (r.chartingForm || []).map((f) => ({ id: f.id, label: f.label, type: f.type, options: (f.options || []).filter((o) => o.trim()), help: f.help })),
      progress: { identified: c.identified, unique: c.unique, taScreened: c.taScreened, taConflicts: c.taConflicts, ftPool: c.sought, ftAssessed: c.assessed, included: c.ftIncluded },
    });
  },

  'add-reviewer'() {
    const id = findReview(pos[0]);
    if (!opt.name || opt.name === true) die('missing --name');
    const r = loadReview(id);
    if (r.reviewers.some((x) => x.name.toLowerCase() === opt.name.toLowerCase())) die(`a reviewer named "${opt.name}" exists already`);
    const rv = newReviewer({ name: opt.name, type: opt.human ? 'human' : 'llm', model: opt.model === true ? '' : opt.model || '' });
    saveShared(id, (cur) => ({ ...cur, reviewers: [...(cur.reviewers || []), rv] }));
    saveDecisions(id, rv.id, (d) => d);
    out({ id: rv.id, name: rv.name, type: rv.type, model: rv.model, note: 'Reload the browser tab if the review is open.' });
  },

  pool() {
    const id = findReview(pos[0]);
    const r = loadReview(id);
    const rv = reviewerOf(r, opt.reviewer);
    const stage = opt.stage;
    if (!['ta', 'ft', 'coding'].includes(stage)) die('--stage must be ta, ft or coding');
    const scope = opt.scope === 'calibration' ? 'calibration' : 'screening';
    let recs = scope === 'calibration' && stage !== 'coding' ? calibrationSet(r, stage)
      : (stage === 'ta' ? uniqueRecords(r) : stage === 'ft' ? ftPool(r) : codingPool(r)).filter((x) => isAssigned(rv, stage, x.id));
    const d = decisionsOf(r, rv.id);
    if (!opt.all) recs = recs.filter((x) => (stage === 'coding' ? !d.coding?.[x.id]?.done : !d[scope]?.[stage]?.[x.id]));
    if (opt.limit) recs = recs.slice(0, Number(opt.limit));
    for (const x of recs) {
      console.log(JSON.stringify({
        recordId: x.id, title: x.title, abstract: x.abstract, keywords: x.keywords, authors: x.authors, year: x.year, journal: x.journal, doi: x.doi,
        ...(stage !== 'ta' ? { pdf: pdfPath(id, x) } : {}),
      }));
    }
    console.error(`${recs.length} record(s) · stage ${stage} · ${scope} · reviewer ${rv.name}`);
  },

  decide() {
    const id = findReview(pos[0]);
    const r = loadReview(id);
    const rv = reviewerOf(r, opt.reviewer);
    const stage = opt.stage;
    if (!['ta', 'ft'].includes(stage)) die('--stage must be ta or ft');
    const scope = opt.scope === 'calibration' ? 'calibration' : 'screening';
    const codeToId = Object.fromEntries(criteriaFor(r, stage).map((c) => [criterionCode(r, c.id).toLowerCase(), c.id]));
    const valid = stage === 'ta' ? { include: 'include', unclear: 'unclear', fulltext: 'unclear', exclude: 'exclude' } : { include: 'include', exclude: 'exclude', not_retrieved: 'not_retrieved' };
    const pool = new Set((stage === 'ta' ? uniqueRecords(r) : ftPool(r)).map((x) => x.id));
    const hash = criteriaHash(r, stage);
    const runId = runIdNow();
    const entries = readJsonl(opt.file);
    const errors = [];
    const decided = {};
    const logs = [];
    for (const [i, e] of entries.entries()) {
      const where = `line ${i + 1} (${e.recordId || '?'})`;
      if (!pool.has(e.recordId)) { errors.push(`${where}: record not in the ${stage} pool`); continue; }
      const decision = valid[String(e.decision || '').toLowerCase()];
      if (!decision) { errors.push(`${where}: decision must be one of ${Object.keys(valid).join(', ')}`); continue; }
      const crit = (e.criteria || []).map((c) => ({ code: String(c.code || ''), met: String(c.met || '').toLowerCase(), evidence: c.evidence ?? null, location: c.location ?? null }));
      const unknown = crit.filter((c) => !codeToId[c.code.toLowerCase()]).map((c) => c.code);
      if (unknown.length) { errors.push(`${where}: unknown criterion code(s) ${unknown.join(', ')}`); continue; }
      if (crit.some((c) => !['yes', 'no', 'unclear'].includes(c.met))) { errors.push(`${where}: criteria[].met must be yes, no or unclear`); continue; }
      const reason = e.reason ? codeToId[String(e.reason).toLowerCase()] : null;
      if (stage === 'ft' && decision === 'exclude' && !reason) { errors.push(`${where}: full-text exclusion needs "reason" (code of an exclusion criterion)`); continue; }
      const confidence = e.confidence == null ? null : Number(e.confidence);
      const agent = { source: 'cli', runId, criteriaHash: hash, confidence: Number.isFinite(confidence) ? confidence : null, rationale: e.rationale || '', criteria: crit };
      decided[e.recordId] = {
        decision, checked: crit.filter((c) => c.met === 'yes').map((c) => codeToId[c.code.toLowerCase()]), reason: decision === 'exclude' ? reason : null,
        note: e.note || '', reviewer: rv.name, decidedAt: new Date().toISOString(), agent,
      };
      logs.push({ type: 'decision', recordId: e.recordId, stage, scope, inputs: e.inputs || null, criteria: crit, decision, reason: e.reason || null, confidence: agent.confidence, rationale: agent.rationale, note: e.note || '', at: new Date().toISOString() });
    }
    if (errors.length) { console.error(errors.join('\n')); if (!opt['allow-partial']) die(`${errors.length} invalid line(s); nothing written (use --allow-partial to write the valid ones)`); }
    if (opt['dry-run']) return out({ valid: Object.keys(decided).length, invalid: errors.length, dryRun: true });
    if (!logs.length) die('nothing to write');
    const logFile = appendLog(id, rv.id, runId, [{ type: 'run', runId, reviewerId: rv.id, reviewer: rv.name, model: opt.model && opt.model !== true ? opt.model : rv.model || null,
      promptVersion: opt['prompt-version'] || null, criteriaHash: hash, stage, scope, startedAt: new Date().toISOString(), tool: `reviewhub-cli ${VERSION}` }, ...logs]);
    saveDecisions(id, rv.id, (d) => {
      const prevAll = d[scope]?.[stage] || {};
      const merged = { ...prevAll };
      for (const [rid, x] of Object.entries(decided)) {
        const prev = prevAll[rid];
        const { history: h = [], ...prevNoHist } = prev || {};
        merged[rid] = { ...x, history: prev ? [...h, prevNoHist] : [] };
      }
      return { ...d, [scope]: { ...(d[scope] || {}), [stage]: merged } };
    });
    out({ written: logs.length, invalid: errors.length, runId, log: logFile, note: 'Reload the browser tab to see the decisions under Compare & consensus.' });
  },

  code() {
    const id = findReview(pos[0]);
    const r = loadReview(id);
    const rv = reviewerOf(r, opt.reviewer);
    const pool = new Set(codingPool(r).map((x) => x.id));
    const codeId = (q) => { const s = String(q).toLowerCase(); return r.codebook.find((c) => c.id === q || c.label.toLowerCase() === s)?.id; };
    const fields = r.chartingForm || [];
    const fieldId = (q) => { const s = String(q).toLowerCase(); return fields.find((f) => f.id === q || f.label.toLowerCase() === s)?.id; };
    const runId = runIdNow();
    const errors = []; const coded = {}; const excerpts = {}; const logs = [];
    for (const [i, e] of readJsonl(opt.file).entries()) {
      const where = `line ${i + 1} (${e.recordId || '?'})`;
      if (!pool.has(e.recordId)) { errors.push(`${where}: record is not an included source`); continue; }
      const ids = (e.codes || []).map((c) => [c, codeId(c)]);
      const badCodes = ids.filter(([, x]) => !x).map(([c]) => c);
      const fv = Object.entries(e.fields || {}).map(([k, v]) => [k, fieldId(k), v]);
      const badFields = fv.filter(([, x]) => !x).map(([k]) => k);
      if (badCodes.length || badFields.length) { errors.push(`${where}: unknown ${[badCodes.length && `code(s) ${badCodes.join(', ')}`, badFields.length && `field(s) ${badFields.join(', ')}`].filter(Boolean).join(' and ')}`); continue; }
      const confidence = e.confidence == null ? null : Number(e.confidence);
      coded[e.recordId] = {
        codes: [...new Set(ids.map(([, x]) => x))], fields: Object.fromEntries(fv.map(([, f, v]) => [f, v])), note: e.note || '', done: true,
        coder: rv.name, codedAt: new Date().toISOString(),
        agent: { source: 'cli', runId, confidence: Number.isFinite(confidence) ? confidence : null, rationale: e.rationale || '' },
      };
      excerpts[e.recordId] = (e.excerpts || []).filter((x) => x.text).map((x) => ({
        id: `hl_${crypto.randomBytes(5).toString('hex')}`, source: 'agent', stage: 'coding', text: x.text, page: x.page ?? null, comment: x.comment || '',
        codeIds: (x.codes || []).map(codeId).filter(Boolean), createdAt: new Date().toISOString(),
      }));
      logs.push({ type: 'coding', recordId: e.recordId, codes: e.codes || [], fields: e.fields || {}, excerpts: e.excerpts || [], confidence: coded[e.recordId].agent.confidence, rationale: e.rationale || '', note: e.note || '', at: new Date().toISOString() });
    }
    if (errors.length) { console.error(errors.join('\n')); if (!opt['allow-partial']) die(`${errors.length} invalid line(s); nothing written (use --allow-partial to write the valid ones)`); }
    if (opt['dry-run']) return out({ valid: logs.length, invalid: errors.length, dryRun: true });
    if (!logs.length) die('nothing to write');
    const logFile = appendLog(id, rv.id, runId, [{ type: 'run', runId, reviewerId: rv.id, reviewer: rv.name, model: opt.model && opt.model !== true ? opt.model : rv.model || null,
      promptVersion: opt['prompt-version'] || null, stage: 'coding', codebookSize: r.codebook.length, startedAt: new Date().toISOString(), tool: `reviewhub-cli ${VERSION}` }, ...logs]);
    saveDecisions(id, rv.id, (d) => {
      const coding = { ...(d.coding || {}) }; const evidence = { ...(d.evidence || {}) };
      for (const [rid, x] of Object.entries(coded)) {
        const prev = coding[rid];
        const { history: h = [], ...prevNoHist } = prev || {};
        coding[rid] = { ...x, history: prev?.done ? [...h, prevNoHist] : h };
        if (excerpts[rid].length) evidence[rid] = [...(evidence[rid] || []), ...excerpts[rid]];
      }
      return { ...d, coding, evidence };
    });
    out({ written: logs.length, invalid: errors.length, runId, log: logFile, note: 'Reload the browser tab to see the coding.' });
  },

  codebook() {
    const id = findReview(pos[0]);
    if (!opt.import || opt.import === true) die('missing --import <codebook.json>');
    const data = readJson(opt.import);
    const list = data.format === 'reviewhub-codebook' ? data.codes : Array.isArray(data) ? data : data.codes;
    if (!Array.isArray(list)) die('expected { "codes": [...] } or an array of codes');
    const by = opt.by && opt.by !== true ? opt.by : 'agent';
    let added = 0;
    saveShared(id, (cur) => {
      const fresh = list.filter((c) => c.label && !(cur.codebook || []).some((x) => x.label === c.label && (x.group || '') === (c.group || '')))
        .map((c) => ({ ...newCode({ label: c.label, group: c.group || '', origin: c.origin || 'a-priori', description: c.definition || c.description || '' }),
          whenToUse: c.whenToUse || '', whenNotToUse: c.whenNotToUse || '', example: c.example || '' }));
      added = fresh.length;
      return { ...cur, codebook: [...(cur.codebook || []), ...fresh], codebookLog: [...(cur.codebookLog || []), ...fresh.map((c) => codebookLogEntry('added', c, by, `imported from ${path.basename(opt.import)}`))] };
    });
    out({ added, skipped: list.length - added, note: 'Reload the browser tab if the review is open.' });
  },

  async 'cloud-list'() {
    const { cloudList } = await import('./cloud-sync.mjs');
    out(await cloudList());
  },

  async pull() {
    const { pull } = await import('./cloud-sync.mjs');
    out({ ...(await pull(WS, pos[0], { force: !!opt.force })), note: 'Reload the browser tab if the review is open locally.' });
  },

  async push() {
    const { push } = await import('./cloud-sync.mjs');
    const res = await push(WS, findReview(pos[0]));
    out(res);
    if (res.conflicts.length) die(`${res.conflicts.length} part(s) were not uploaded (see "conflicts" above); everything else was.`);
  },

  paper() {
    const id = findReview(pos[0]);
    const r = loadReview(id);
    const data = buildPaperData(r, { version: VERSION });
    const target = opt.out && opt.out !== true ? path.resolve(opt.out) : path.join(reviewDir(id), 'exports', 'paper-data.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    writeAtomic(target, data);
    out({ written: target, included: data.included.length, identified: data.prisma.identified });
  },
};

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') commands.help();
else if (!commands[cmd]) die(`unknown command "${cmd}" (see: node scripts/rh.mjs help)`);
else Promise.resolve(commands[cmd]()).catch((e) => die(e.message));
