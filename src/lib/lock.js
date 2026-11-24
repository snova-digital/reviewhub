// Lead reviewer and the official start of a review.
//
// Everyone sees everything, but only a lead reviewer changes the shared plan (protocol, criteria, searches, records,
// settings, reviewers). When the lead starts the review, the plan is captured as a baseline in review.lock and frozen.
// Any later difference to that baseline pauses screening for everyone until the lead resolves it:
//   acknowledge → recorded as a protocol amendment (with reason) and becomes the new baseline
//   undo        → the plan goes back to the baseline
//   restart     → all screening, coding and appraisal so far is archived (never deleted) and work starts again
// Reviews without a lead (older reviews) let every human reviewer edit, as before.
//
// review.lock = { startedAt, startedBy, baseline: { type, settings, protocol, criteria, runs }, log: [ … ] }
// All keys are optional, so older reviews need no migration.
import { calibrationPool, criterionCode, seededSample } from './model.js';
import { frameworkElements, frameworkValues, reviewSettings } from './methods.js';

const clone = (x) => JSON.parse(JSON.stringify(x ?? null));
const stamp = () => new Date().toISOString();
const t = (v) => (v ?? '').toString().trim();

// ---- roles ---------------------------------------------------------------------------------------
export const leadsOf = (review) => (review.reviewers || []).filter((r) => r.lead && r.type !== 'llm');
export const isLead = (review, rid) => leadsOf(review).some((r) => r.id === rid);

// May this reviewer change shared review content? Leads only; without any lead, every human reviewer.
export function canManage(review, rid) {
  const rv = (review.reviewers || []).find((r) => r.id === rid);
  if (!rv || rv.type === 'llm') return false;
  const leads = leadsOf(review);
  return leads.length ? leads.some((r) => r.id === rid) : true;
}

export const isStarted = (review) => !!review.lock?.startedAt;

// ---- baseline ------------------------------------------------------------------------------------
// Raw copy of everything that is frozen once the review starts. Run notes, highlight terms, protocol notes and the
// review title stay editable (by the lead) without pausing anything.
export function captureBaseline(review) {
  const s = reviewSettings(review);
  const p = review.protocol || {};
  return clone({
    type: review.type || 'scoping',
    settings: { framework: s.framework, customElements: s.customElements, appraisal: !!s.appraisal, dedup: s.dedup },
    protocol: {
      registration: p.registration || '', objective: p.objective || '', questions: p.questions || [],
      elements: p.elements || {}, pcc: p.pcc || {}, evidenceSources: p.evidenceSources || '',
    },
    criteria: review.criteria || [],
    runs: review.runs || [],
  });
}

const fromBaseline = (review, b) => ({
  ...review,
  type: b.type,
  settings: { ...(review.settings || {}), ...b.settings },
  protocol: { ...review.protocol, ...b.protocol },
  criteria: b.criteria,
  runs: b.runs,
});

const RUN_FIELDS = {
  database: 'database', platform: 'platform', sourceType: 'source type', stream: 'stream', variant: 'query variant',
  searchString: 'search string', fields: 'fields searched', dateRun: 'date executed', dateRange: 'date range',
  filters: 'limits / filters', reportedHits: 'reported hits',
};
const CRIT_FIELDS = { code: 'code', kind: 'type', element: 'element', group: 'group', text: 'wording', excludeText: 'exclusion side', stages: 'stages' };
const METHOD = { type: 'Review type', framework: 'Eligibility framework', customElements: 'Custom framework elements', appraisal: 'Critical appraisal', dedup: 'Deduplication mode' };
const PROTOCOL = { registration: 'Protocol registration', objective: 'Objective', evidenceSources: 'Types of evidence sources' };

// Normalised, comparable view of the frozen part of a review.
function view(src) {
  const s = reviewSettings(src);
  const p = src.protocol || {};
  const vals = frameworkValues(src);
  return {
    method: {
      type: src.type || 'scoping', framework: s.framework, appraisal: s.appraisal ? 'on' : 'off', dedup: s.dedup,
      customElements: s.framework === 'custom' ? (s.customElements || []).map((e) => t(e.label)).filter(Boolean).join(' | ') : '',
    },
    protocol: { registration: t(p.registration), objective: t(p.objective), evidenceSources: t(p.evidenceSources) },
    questions: (p.questions || []).map(t).filter(Boolean),
    elements: Object.fromEntries(frameworkElements(src).map(([k, label]) => [label, t(vals[k])])),
    criteria: (src.criteria || []).map((c) => ({
      id: c.id, code: criterionCode(src, c.id), kind: c.kind, element: c.element || '', group: t(c.group), text: t(c.text),
      excludeText: c.kind === 'paired' ? t(c.excludeText) : '', stages: [...(c.stages || [])].sort().join(' + '),
    })),
    runs: (src.runs || []).map((r) => ({
      id: r.id, name: t(r.database) || 'untitled run',
      ...Object.fromEntries(Object.keys(RUN_FIELDS).map((k) => [k, k === 'reportedHits' ? (r[k] ?? '') : t(r[k])])),
      imports: (r.imports || []).map((i) => ({ id: i.id, fileName: i.fileName, count: i.count })),
    })),
  };
}

// Differences between the baseline and the current review: [{ area, label, before, after }].
export function planChanges(review) {
  if (!isStarted(review) || !review.lock.baseline) return [];
  const a = view(fromBaseline(review, review.lock.baseline));
  const b = view(review);
  const out = [];
  const add = (area, label, before = null, after = null) => out.push({ area, label, before, after });

  for (const k of Object.keys(METHOD)) if (String(a.method[k]) !== String(b.method[k])) add('method', `${METHOD[k]} changed`, a.method[k], b.method[k]);
  for (const k of Object.keys(PROTOCOL)) if (a.protocol[k] !== b.protocol[k]) add('protocol', `${PROTOCOL[k]} edited`, a.protocol[k], b.protocol[k]);
  for (let i = 0; i < Math.max(a.questions.length, b.questions.length); i++) {
    const [x, y] = [a.questions[i], b.questions[i]];
    if (x === y) continue;
    add('protocol', `Review question ${i + 1} ${x === undefined ? 'added' : y === undefined ? 'removed' : 'edited'}`, x ?? null, y ?? null);
  }
  for (const label of new Set([...Object.keys(a.elements), ...Object.keys(b.elements)])) {
    const [x, y] = [a.elements[label], b.elements[label]];
    if (x !== y) add('protocol', `${label} ${x === undefined ? 'added' : y === undefined ? 'removed' : 'edited'}`, x ?? null, y ?? null);
  }

  const critA = new Map(a.criteria.map((c) => [c.id, c]));
  const critB = new Map(b.criteria.map((c) => [c.id, c]));
  for (const c of a.criteria) if (!critB.has(c.id)) add('criteria', `Criterion ${c.code} removed`, c.text, null);
  for (const c of b.criteria) {
    const old = critA.get(c.id);
    if (!old) { add('criteria', `Criterion ${c.code} added`, null, c.text); continue; }
    const diff = Object.keys(CRIT_FIELDS).filter((k) => old[k] !== c[k]);
    if (!diff.length) continue;
    const name = old.code === c.code ? c.code : `${old.code} → ${c.code}`;
    const k = diff.find((x) => x === 'text' || x === 'excludeText') || diff[0];
    add('criteria', `Criterion ${name}: ${diff.map((x) => CRIT_FIELDS[x]).join(', ')} changed`, old[k], c[k]);
  }

  const runA = new Map(a.runs.map((r) => [r.id, r]));
  const runB = new Map(b.runs.map((r) => [r.id, r]));
  for (const r of a.runs) if (!runB.has(r.id)) add('searches', `Search run ${r.name} deleted`);
  for (const r of b.runs) {
    const old = runA.get(r.id);
    if (!old) { add('searches', `New search run: ${r.name}`, null, r.searchString || null); }
    else {
      const diff = Object.keys(RUN_FIELDS).filter((k) => String(old[k]) !== String(r[k]));
      if (diff.length) {
        const k = diff.includes('searchString') ? 'searchString' : diff[0];
        add('searches', `Search run ${r.name}: ${diff.map((x) => RUN_FIELDS[x]).join(', ')} changed`, String(old[k]), String(r[k]));
      }
    }
    const impA = new Map((old?.imports || []).map((i) => [i.id, i]));
    const impB = new Set(r.imports.map((i) => i.id));
    for (const i of r.imports) if (!impA.has(i.id)) add('imports', `${r.name}: new import ${i.fileName} (${i.count} records)`);
    for (const i of old?.imports || []) if (!impB.has(i.id)) add('imports', `${r.name}: import ${i.fileName} removed (${i.count} records)`);
  }
  return out;
}

// ---- optional calibration round ------------------------------------------------------------------
// Before the full review the lead may start a calibration round (settings.calibrationSize, settings.calibrationStream).
// Reviews that already have calibration decisions count as having one.
export function calibrationStarted(review) {
  if (review.calibration?.startedAt) return true;
  return Object.values(review.decisions || {}).some((d) => Object.keys(d.calibration?.ta || {}).length || Object.keys(d.calibration?.ft || {}).length);
}

// Search streams the calibration set can be drawn from (only with search streams switched on, and at least two).
export function calibrationStreams(review) {
  if (!reviewSettings(review).streams) return [];
  const streams = [...new Set((review.runs || []).map((r) => t(r.stream)).filter(Boolean))];
  return streams.length > 1 ? streams : [];
}

// Draw the title/abstract calibration set: a seeded random sample, stored as record ids so it never changes under the
// reviewers. Redrawing with the same seed (a different size or stream) keeps as many of the drawn records as possible.
function draw(review, seed, size, stream) {
  const pool = calibrationPool(review, 'ta', stream);
  return { method: 'random', seed, size, stream, poolSize: pool.length, drawnAt: stamp(), ta: seededSample(pool, `${seed}|ta`, size).map((r) => r.id) };
}
const newSeed = () => Math.random().toString(36).slice(2, 10);

export function startCalibration(review, rid, { size, stream = '' }) {
  return {
    ...review,
    settings: { ...(review.settings || {}), calibrationSize: size, calibrationStream: stream },
    calibration: { startedAt: stamp(), startedBy: rid, ...draw(review, newSeed(), size, stream) },
  };
}

// Lead changes size or stream while the round runs. Older rounds without a seed keep "first N" (only the settings change).
export function changeCalibration(review, { size, stream = '' }) {
  const settings = { ...(review.settings || {}), calibrationSize: size, calibrationStream: stream };
  const cal = review.calibration;
  if (!cal?.seed) return { ...review, settings };
  return { ...review, settings, calibration: { ...cal, ...draw(review, cal.seed, size, stream) } };
}

// One line for the methods section, e.g. "random sample of 25 of 1,340 records (stream RQ1; seed k3x9a1bz)".
export function calibrationSummary(review) {
  const cal = review.calibration;
  if (!cal?.seed) return `first ${review.settings?.calibrationSize || 20} records in screening order`;
  return `random sample of ${cal.ta?.length ?? cal.size} of ${cal.poolSize.toLocaleString('en')} records (${cal.stream ? `stream ${cal.stream}; ` : ''}seed ${cal.seed})`;
}

// What blocks screening / coding / appraisal work right now:
//   'paused'                  – the frozen plan changed and the lead has not resolved it
//   'not-started'             – main work before the lead started the full review
//   'calibration-not-started' – calibration before the lead started a calibration round (or the full review)
export function workBlock(review, scope = 'screening') {
  if (planChanges(review).length) return 'paused';
  if (scope === 'calibration') return isStarted(review) || calibrationStarted(review) ? null : 'calibration-not-started';
  return isStarted(review) ? null : 'not-started';
}

// Main screening decisions made so far, over all reviewer files.
export function mainDecisionCount(review) {
  let n = 0;
  for (const d of Object.values(review.decisions || {})) {
    n += Object.keys(d.screening?.ta || {}).length + Object.keys(d.screening?.ft || {}).length;
    n += Object.values(d.coding || {}).filter((c) => c.done).length + Object.values(d.appraisal || {}).filter((c) => c.done).length;
  }
  return n;
}

// ---- actions (all pure: review in, review out) ------------------------------------------------------
const logEntry = (review, entry) => [...(review.lock?.log || []), entry];

export function startReview(review, rid) {
  const at = stamp();
  return {
    ...review,
    lock: { startedAt: at, startedBy: rid, baseline: captureBaseline(review), log: logEntry(review, { kind: 'start', at, by: rid, decisionsBefore: mainDecisionCount(review) }) },
  };
}

// Accept the current plan as an amendment: logged with its reason and the list of changes, then the new baseline.
export function acknowledgeChanges(review, rid, reason) {
  const at = stamp();
  return {
    ...review,
    lock: {
      ...review.lock,
      baseline: captureBaseline(review),
      log: logEntry(review, { kind: 'amendment', at, by: rid, reason: t(reason), changes: planChanges(review), decisionsBefore: mainDecisionCount(review) }),
    },
  };
}

// Undo is not offered for added or removed imports: those carry records (and possibly decisions). Remove or keep
// the import on the searches page instead.
export const canRevert = (review) => !planChanges(review).some((c) => c.area === 'imports');

export function revertChanges(review) {
  const b = clone(review.lock.baseline);
  const notes = Object.fromEntries((review.runs || []).map((r) => [r.id, r.notes]));
  const importsNow = Object.fromEntries((review.runs || []).map((r) => [r.id, r.imports]));
  return {
    ...review,
    type: b.type,
    settings: { ...(review.settings || {}), ...b.settings },
    protocol: { ...review.protocol, ...b.protocol },
    criteria: b.criteria,
    runs: b.runs.map((r) => ({ ...r, notes: notes[r.id] ?? r.notes, imports: importsNow[r.id] ?? r.imports })),
  };
}

// Start from scratch: every reviewer's screening, evidence, coding and appraisal moves into `archive` inside their
// own file, consensus into review.archive. Calibration rounds stay (they belong to the time before the start).
// Nothing is deleted; take a backup first (api.backup).
export function restartReview(review, rid, reason) {
  const at = stamp();
  const n = mainDecisionCount(review);
  const decisions = Object.fromEntries(Object.entries(review.decisions || {}).map(([id, d]) => [id, {
    ...d,
    screening: { ta: {}, ft: {} }, evidence: {}, coding: {}, appraisal: {},
    archive: [...(d.archive || []), { archivedAt: at, reason: t(reason), screening: d.screening, evidence: d.evidence, coding: d.coding, appraisal: d.appraisal }],
  }]));
  return {
    ...review,
    decisions,
    consensus: { ta: {}, ft: {}, coding: {}, appraisal: {} },
    archive: [...(review.archive || []), { archivedAt: at, reason: t(reason), consensus: review.consensus }],
    lock: {
      startedAt: at, startedBy: rid, baseline: captureBaseline(review),
      log: logEntry(review, { kind: 'restart', at, by: rid, reason: t(reason), changes: planChanges(review), decisionsArchived: n }),
    },
  };
}
