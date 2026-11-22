// Data model + domain rules for a literature review (scoping, systematic, rapid, …).
// Method-specific wording and templates live in methods.js.
import { CHARTING_TEMPLATES, frameworkValues, frameworkElements, profileOf, reviewSettings } from './methods.js';

export { REVIEW_TYPES } from './methods.js';

export const uid = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// PCC elements + practical eligibility dimensions (kept for older imports; use criterionElements(review) from methods.js).
export const CRITERION_ELEMENTS = [
  { value: 'population', label: 'Population' },
  { value: 'concept', label: 'Concept' },
  { value: 'context', label: 'Context' },
  { value: 'source', label: 'Types of evidence source' },
  { value: 'language', label: 'Language' },
  { value: 'date', label: 'Date range' },
  { value: 'other', label: 'Other' },
];

export const STAGES = {
  ta: { key: 'ta', label: 'Title & abstract', short: 'T/A' },
  ft: { key: 'ft', label: 'Full text', short: 'FT' },
};

export const DECISIONS = {
  ta: [
    { value: 'include', label: 'Include', key: 'i', tone: 'emerald' },
    // Stored as 'unclear' (schema v1 value); shown as the "review with full text" basket.
    { value: 'unclear', label: 'Review with full text', key: 'f', tone: 'amber' },
    { value: 'exclude', label: 'Exclude', key: 'e', tone: 'rose' },
  ],
  ft: [
    { value: 'include', label: 'Include', key: 'i', tone: 'emerald' },
    { value: 'exclude', label: 'Exclude', key: 'e', tone: 'rose' },
    { value: 'not_retrieved', label: 'Not retrievable', key: 'n', tone: 'stone' },
  ],
};

export const DECISION_LABEL = { include: 'Include', unclear: 'Review with full text', exclude: 'Exclude', not_retrieved: 'Not retrievable' };

export const DATABASES = [
  'Scopus', 'Web of Science Core Collection', 'PubMed / MEDLINE', 'IEEE Xplore', 'ACM Digital Library',
  'EBSCO (Business Source Complete)', 'ProQuest', 'PsycINFO', 'CINAHL', 'Embase', 'Google Scholar',
  'SSRN', 'AIS eLibrary', 'Grey literature', 'Citation searching (backward/forward)', 'Other',
];

export function newReview({ title, type = 'scoping' }) {
  const profile = profileOf({ type });
  return {
    schemaVersion: 2,
    type,
    title,
    protocol: {
      registration: '',
      reviewers: [],
      objective: '',
      questions: [''],
      pcc: { population: '', concept: '', context: '' },
      elements: {},
      evidenceSources: '',
      highlightTerms: { include: [], exclude: [] },
      notes: '',
    },
    criteria: [],
    runs: [],
    records: [],
    reviewers: [],
    codebook: [],
    codebookLog: [],
    chartingForm: [],
    appraisalTool: null,
    search: { blocks: [], queries: [] },
    consensus: { ta: {}, ft: {}, coding: {}, appraisal: {} },
    settings: { calibrationSize: 20, framework: profile.framework, dedup: 'strict', streams: false, appraisal: profile.appraisal },
  };
}

// Has every element of the chosen eligibility framework been filled in?
export function frameworkComplete(review) {
  const v = frameworkValues(review);
  const els = frameworkElements(review);
  return els.length > 0 && els.every(([k]) => (v[k] || '').trim());
}

// ---- reviewers -------------------------------------------------------------
// Each reviewer's work lives in its own file (data/reviews/<id>/decisions/<reviewerId>.json),
// loaded into review.decisions[reviewerId]. Only human reviewers determine final decisions;
// LLM reviewers are compared against them but never decide on their own.
export const WORK_STAGES = [
  { key: 'ta', label: 'Title / abstract' },
  { key: 'ft', label: 'Full text' },
  { key: 'coding', label: 'Extraction & coding' },
  { key: 'appraisal', label: 'Critical appraisal' },
];
// Work stages active in this review (appraisal only when switched on in the settings).
export const workStagesFor = (review) => WORK_STAGES.filter((s) => s.key !== 'appraisal' || reviewSettings(review).appraisal);
export const ASSIGNMENT_MODES = [
  { value: 'full', label: 'Full review (every record)' },
  { value: 'sample', label: 'Random cross-check (sample)' },
  { value: 'none', label: 'Not participating' },
];

export function newReviewer({ name, type = 'human', model = '' }) {
  const a = { mode: 'full', percent: 20 };
  return { id: uid('rv'), name, type, model, assignment: { ta: { ...a }, ft: { ...a }, coding: { ...a }, appraisal: { ...a } }, createdAt: new Date().toISOString() };
}

export const emptyDecisions = (reviewerId) => ({
  reviewerId, rev: 0, screening: { ta: {}, ft: {} }, calibration: { ta: {}, ft: {} }, calibrationArchive: [], evidence: {}, coding: {}, appraisal: {},
});

export const reviewerById = (review, id) => review.reviewers?.find((r) => r.id === id);
export const isHuman = (rv) => rv?.type !== 'llm';
export const decisionsOf = (review, rid) => review.decisions?.[rid] || emptyDecisions(rid);

// Deterministic sample: a record is in a reviewer's cross-check sample if a hash of
// (reviewer, stage, record) falls below the percentage. Stable as the pool grows, reproducible, no stored list.
function hash01(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  // murmur3 fmix32 finaliser: FNV alone barely changes when only the last character differs (rec ids are sequential-ish).
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}
export function isAssigned(reviewer, stage, recordId) {
  const a = reviewer?.assignment?.[stage] || { mode: 'full' };
  if (a.mode === 'none') return false;
  if (a.mode === 'sample') return hash01(`${reviewer.id}|${stage}|${recordId}`) < (Number(a.percent) || 0) / 100;
  return true;
}
export const assignmentLabel = (reviewer, stage) => {
  const a = reviewer?.assignment?.[stage] || { mode: 'full' };
  return a.mode === 'sample' ? `${a.percent}% sample` : a.mode === 'none' ? 'not participating' : 'full';
};

export function newCriterion(kind) {
  // No default element: a pre-filled 'concept' was silently kept for criteria like "Not peer-reviewed".
  return { id: uid('c'), kind, element: '', text: '', stages: ['ta', 'ft'] };
}

export function newRun() {
  return {
    id: uid('run'),
    database: '',
    platform: '',
    searchString: '',
    fields: 'Title, abstract, keywords',
    dateRun: new Date().toISOString().slice(0, 10),
    dateRange: '',
    filters: '',
    reportedHits: null,
    stream: '',
    variant: '',
    notes: '',
    imports: [],
  };
}

export const criteriaFor = (review, stage) => review.criteria.filter((c) => c.stages.includes(stage));

// Records that are part of the screening pool (not flagged as duplicates).
export const uniqueRecords = (review) => review.records.filter((r) => !r.duplicateOf);

// ---- final decisions ---------------------------------------------------------
// Final = consensus (set in the comparison step) if any; otherwise derived from the human reviewers
// who decided the record: unanimous → that decision, a single reviewer → theirs, disagreement → conflict.
// At T/A, include and "review with full text" both send a record on, so they don't conflict
// (final: include if all said include, otherwise full text). Only exclude vs. forward is a conflict.
const FORWARD = ['include', 'unclear'];

export function humanVotes(review, stage, recordId, scope = 'screening') {
  return (review.reviewers || []).filter(isHuman).map((rv) => ({ rv, d: decisionsOf(review, rv.id)[scope]?.[stage]?.[recordId] })).filter((x) => x.d);
}

export function finalDecision(review, stage, recordId) {
  const c = review.consensus?.[stage]?.[recordId];
  if (c) return { decision: c.decision, reason: c.reason || null, status: 'consensus' };
  const votes = humanVotes(review, stage, recordId);
  if (!votes.length) return { decision: null, reason: null, status: 'pending' };
  const ds = votes.map((v) => v.d.decision);
  const status = votes.length === 1 ? 'single' : 'agreed';
  if (ds.every((d) => d === ds[0])) return { decision: ds[0], reason: votes.find((v) => v.d.reason)?.d.reason || null, status };
  if (stage === 'ta' && ds.every((d) => FORWARD.includes(d))) return { decision: 'unclear', reason: null, status };
  return { decision: null, reason: null, status: 'conflict' };
}

export const taDecision = (review, id) => finalDecision(review, 'ta', id).decision;
export const ftDecision = (review, id) => finalDecision(review, 'ft', id).decision;

// Per JBI: anything included OR sent to full text at T/A goes on to full-text assessment.
export const ftPool = (review) =>
  uniqueRecords(review).filter((r) => FORWARD.includes(taDecision(review, r.id)));
export const codingPool = (review) => ftPool(review).filter((r) => ftDecision(review, r.id) === 'include');

// Critical appraisal covers the same included sources as extraction & coding.
export const appraisalPool = codingPool;

export const stagePool = (review, stage) => (stage === 'ta' ? uniqueRecords(review) : stage === 'ft' ? ftPool(review) : codingPool(review));

// Calibration ("demo") set: the first N records of a stage's pool, screened separately from the main screening.
export const calibrationSet = (review, stage) => stagePool(review, stage).slice(0, review.settings?.calibrationSize || 20);

// Final codes of a record: consensus if set, otherwise those of the (human) coders; conflict if they differ.
export function finalCoding(review, recordId) {
  const c = review.consensus?.coding?.[recordId];
  if (c) return { codes: c.codes, status: 'consensus' };
  const votes = (review.reviewers || []).filter(isHuman).map((rv) => decisionsOf(review, rv.id).coding?.[recordId]).filter((x) => x?.done);
  if (!votes.length) return { codes: [], status: 'pending' };
  const key = (v) => [...v.codes].sort().join('|');
  if (votes.every((v) => key(v) === key(votes[0]))) return { codes: votes[0].codes, status: votes.length === 1 ? 'single' : 'agreed' };
  return { codes: [...new Set(votes.flatMap((v) => v.codes))], status: 'conflict' };
}

// Codes that are actually final: unresolved conflicts count as not yet coded, so figures and analyses never
// show codes the reviewers have not agreed on.
export const settledCodes = (review, recordId) => { const f = finalCoding(review, recordId); return f.status === 'conflict' || f.status === 'pending' ? [] : f.codes; };

export const groupCodes = (codebook) => {
  const groups = new Map();
  for (const c of codebook) { const g = c.group || 'Ungrouped'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); }
  return [...groups.entries()];
};

// A code of the codebook. `description` is the definition; `origin` tells a-priori (deductive) from emergent (inductive) codes.
export function newCode({ label = '', group = '', origin = 'a-priori', description = '' } = {}) {
  return { id: uid('code'), label, group, description, whenToUse: '', whenNotToUse: '', example: '', origin, createdAt: new Date().toISOString() };
}

// Deductive starting point: one code per review question, in a "Review questions" group. Meant to be refined.
export const codesFromQuestions = (review) => (review.protocol.questions || []).map((q, i) => q.trim() && newCode({
  label: `RQ${i + 1}: ${q.trim().length > 70 ? `${q.trim().slice(0, 70)}…` : q.trim()}`, group: 'Review questions', description: q.trim(),
})).filter(Boolean);

// Codebook change log entry (kept in review.codebookLog, reported as the audit trail of the coding frame).
export const codebookLogEntry = (action, code, by, detail = '') => ({ at: new Date().toISOString(), action, codeId: code.id, label: code.label, by, detail });

// ---- charting form (structured data extraction) -----------------------------------
export function newField(extra = {}) {
  return { id: uid('fld'), label: '', type: 'text', options: [], help: '', ...extra };
}
export const chartingTemplate = (key) => (CHARTING_TEMPLATES[key]?.fields || []).map((x) => newField({ ...x, options: [...x.options] }));

const sameValue = (a, b) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a ?? '') === JSON.stringify(Array.isArray(b) ? [...b].sort() : b ?? '');
const emptyValue = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);

// Final value of a charting field: consensus if set, else the value of the human coders if they agree.
export function finalField(review, recordId, fieldId) {
  const c = review.consensus?.coding?.[recordId]?.fields;
  if (c && fieldId in c) return { value: c[fieldId], status: 'consensus' };
  const votes = (review.reviewers || []).filter(isHuman).map((rv) => decisionsOf(review, rv.id).coding?.[recordId]).filter((x) => x?.done)
    .map((x) => x.fields?.[fieldId]).filter((v) => !emptyValue(v));
  if (!votes.length) return { value: null, status: 'pending' };
  if (votes.every((v) => sameValue(v, votes[0]))) return { value: votes[0], status: votes.length === 1 ? 'single' : 'agreed' };
  return { value: null, values: votes, status: 'conflict' };
}
export const fieldText = (v) => (Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v));

// ---- critical appraisal -------------------------------------------------------------
// Final appraisal of a record: consensus if set, else the human appraisers' judgements if they agree (overall + per item).
export function finalAppraisal(review, recordId) {
  const c = review.consensus?.appraisal?.[recordId];
  if (c) return { ...c, status: 'consensus' };
  const votes = (review.reviewers || []).filter(isHuman).map((rv) => decisionsOf(review, rv.id).appraisal?.[recordId]).filter((x) => x?.done);
  if (!votes.length) return { overall: null, answers: {}, status: 'pending' };
  const same = votes.every((v) => v.overall === votes[0].overall && sameValue(Object.entries(v.answers || {}).sort(), Object.entries(votes[0].answers || {}).sort()));
  if (same) return { overall: votes[0].overall, answers: votes[0].answers || {}, status: votes.length === 1 ? 'single' : 'agreed' };
  return { overall: null, answers: {}, status: 'conflict' };
}

// ---- reports and studies (PRISMA 2020) ------------------------------------------------
// Several reports (papers) can describe one study: record.studyOf points at the "main" report of the study.
export const studyKey = (r) => r.studyOf || r.id;

// ---- agent reviewers: criteria fingerprint --------------------------------------------
// A short hash of the criteria that applied at a stage. Agent decisions store it, so decisions made under
// criteria that were changed later can be flagged.
export function criteriaHash(review, stage) {
  const text = criteriaFor(review, stage).map((c) => `${criterionCode(review, c.id)}|${c.kind}|${c.text.trim()}`).join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `fnv1a:${(h >>> 0).toString(16).padStart(8, '0')}`;
}

// Suggest a decision from the checklist; the reviewer always confirms.
// Inclusion criteria without a group must all be met; for criteria sharing a `group`
// (e.g. the RQ streams) at least one of the group must be met.
export function suggestDecision(review, stage, checked) {
  const crit = criteriaFor(review, stage);
  const exc = crit.filter((c) => c.kind === 'exclusion');
  const inc = crit.filter((c) => c.kind === 'inclusion');
  if (exc.some((c) => checked.includes(c.id))) return 'exclude';
  if (inc.length) {
    const solo = inc.filter((c) => !c.group);
    const groups = [...new Set(inc.filter((c) => c.group).map((c) => c.group))];
    const ok = solo.every((c) => checked.includes(c.id))
      && groups.every((g) => inc.some((c) => c.group === g && checked.includes(c.id)));
    if (ok) return 'include';
  }
  return stage === 'ta' ? 'unclear' : null;
}

// Display code: an explicit `code` (e.g. "IC1", "RQ2", "E3") wins, otherwise ICn / ECn by position.
export const criterionCode = (review, id) => {
  const i = review.criteria.findIndex((c) => c.id === id);
  if (i < 0) return '?';
  const c = review.criteria[i];
  if (c.code) return c.code;
  const n = review.criteria.filter((x, j) => x.kind === c.kind && j <= i).length;
  return `${c.kind === 'inclusion' ? 'IC' : 'EC'}${n}`;
};

export const criterionLabel = (review, id) => {
  const c = review.criteria.find((x) => x.id === id);
  return c ? `${criterionCode(review, id)}: ${c.text}` : '(deleted criterion)';
};

export const STREAM_VARIANTS = [
  { value: 'primary', label: 'Primary query' },
  { value: 'supplementary', label: 'Supplementary query' },
];

export const runLabel = (run) =>
  [run.database || '(unnamed)', run.stream, run.variant, run.part && `part ${run.part}`].filter(Boolean).join(' · ');
