// "Paper data": one JSON file from which every figure and table of the final paper can be built.
// FINAL values only (consensus, or agreement of the human reviewers); per-reviewer raw decisions are not included,
// except pairwise agreement statistics. Used by the Export page (download) and by the CLI (`rh paper`, written to disk).
// Plain ESM without browser APIs, so Node can import it.
import { prismaCounts } from './prisma.js';
import { cohen, compareCoding, comparePair } from './agreement.js';
import { codingPool, criterionCode, reasonLabel, decisionsOf, finalAppraisal, finalCoding, finalDecision, finalField, ftPool, settledCodes } from './model.js';
import { frameworkElements, frameworkValues, profileOf, reviewSettings } from './methods.js';

export const PAPER_DATA_VERSION = 1;

function pairs(reviewers) {
  const out = [];
  for (let i = 0; i < reviewers.length; i++) for (let j = i + 1; j < reviewers.length; j++) out.push([reviewers[i], reviewers[j]]);
  return out;
}
const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

export function buildPaperData(review, { version = null, generatedAt = new Date().toISOString() } = {}) {
  const profile = profileOf(review);
  const settings = reviewSettings(review);
  const reviewers = review.reviewers || [];
  const dec = (rv) => decisionsOf(review, rv.id);
  const runById = Object.fromEntries(review.runs.map((r) => [r.id, r]));
  const prisma = prismaCounts(review);

  // ---- agreement --------------------------------------------------------------------------
  const screeningAgreement = (scope, stage) => pairs(reviewers).map(([a, b]) => {
    const p = comparePair(dec(a)[scope]?.[stage] || {}, dec(b)[scope]?.[stage] || {}, {});
    if (!p.shared.length) return null;
    return { a: a.name, b: b.name, aId: a.id, bId: b.id, aType: a.type, bType: b.type, n: p.shared.length,
      percentAgreement: round(p.decision.agree), kappa: round(p.decision.kappa), kappaExcludeVsForward: round(p.binary.kappa) };
  }).filter(Boolean);
  const agreement = {
    ta: screeningAgreement('screening', 'ta'),
    ft: screeningAgreement('screening', 'ft'),
    calibration: { ta: screeningAgreement('calibration', 'ta'), ft: screeningAgreement('calibration', 'ft') },
    coding: pairs(reviewers).map(([a, b]) => {
      const p = compareCoding(dec(a).coding || {}, dec(b).coding || {}, review.codebook);
      if (!p.shared.length) return null;
      const used = p.perCode.filter((c) => c.used && c.kappa != null);
      return { a: a.name, b: b.name, aId: a.id, bId: b.id, n: p.shared.length, identicalCodeSets: round(p.exact),
        meanKappaPerCode: used.length ? round(used.reduce((s, c) => s + c.kappa, 0) / used.length) : null };
    }).filter(Boolean),
    appraisal: pairs(reviewers).map(([a, b]) => {
      const A = dec(a).appraisal || {}; const B = dec(b).appraisal || {};
      const shared = Object.keys(A).filter((id) => A[id]?.done && B[id]?.done);
      if (!shared.length) return null;
      const k = cohen(shared.map((id) => [A[id].overall, B[id].overall]));
      return { a: a.name, b: b.name, aId: a.id, bId: b.id, n: shared.length, percentAgreement: round(k.agree), kappa: round(k.kappa) };
    }).filter(Boolean),
  };

  // ---- included sources --------------------------------------------------------------------
  const fields = review.chartingForm || [];
  const fieldKey = (f, i) => (f.label || `field_${i + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `field_${i + 1}`;
  const keys = fields.map(fieldKey);
  const tool = review.appraisalTool;
  const included = codingPool(review).map((r) => {
    const fin = finalCoding(review, r.id);
    const app = settings.appraisal && tool ? finalAppraisal(review, r.id) : null;
    return {
      id: r.id, title: r.title, authors: r.authors, year: r.year, journal: r.journal, doi: r.doi, keywords: r.keywords,
      database: runById[r.runId]?.database || null, studyOf: r.studyOf || null,
      // Unresolved conflicts: no codes (status says why), so figures only use agreed codes.
      codes: settledCodes(review, r.id), codingStatus: fin.status,
      fields: Object.fromEntries(fields.map((f, i) => [keys[i], finalField(review, r.id, f.id).value])),
      appraisal: app ? { tool: tool.tool, overall: app.overall, items: app.answers, status: app.status } : null,
    };
  });

  const excludedFullText = ftPool(review).map((r) => ({ r, fin: finalDecision(review, 'ft', r.id) })).filter((x) => x.fin.decision === 'exclude')
    .map(({ r, fin }) => ({ id: r.id, title: r.title, authors: r.authors, year: r.year, doi: r.doi,
      reasonCode: fin.reason ? criterionCode(review, fin.reason) : null, reason: fin.reason ? reasonLabel(review, fin.reason) : null }));

  const p = review.protocol || {};
  const values = frameworkValues(review);
  return {
    format: 'reviewhub-paper-data', version: PAPER_DATA_VERSION, generatedAt, reviewhubVersion: version,
    review: {
      id: review.id, title: review.title, type: review.type || 'scoping', guideline: profile.guideline, methodology: profile.methodology,
      framework: settings.framework,
      protocol: {
        objective: p.objective || '', questions: (p.questions || []).filter((q) => q.trim()), registration: p.registration || '',
        elements: Object.fromEntries(frameworkElements(review).map(([k, label]) => [k, { label, text: values[k] || '' }])),
        evidenceSources: p.evidenceSources || '', deviations: p.notes || '',
        // Official start and every change acknowledged afterwards (lock.js), for the deviations section.
        startedAt: review.lock?.startedAt || null,
        // Optional calibration (pilot) round: how its title/abstract set was drawn.
        calibration: review.calibration?.seed
          ? { method: 'random', size: review.calibration.ta?.length ?? null, poolSize: review.calibration.poolSize, stream: review.calibration.stream || null, seed: review.calibration.seed, drawnAt: review.calibration.drawnAt }
          : null,
        amendments: (review.lock?.log || []).filter((e) => e.kind === 'amendment' || e.kind === 'restart').map((e) => ({
          kind: e.kind, at: e.at, by: reviewers.find((rv) => rv.id === e.by)?.name || null, reason: e.reason || '',
          changes: (e.changes || []).map((c) => c.label), decisionsBefore: e.decisionsBefore ?? e.decisionsArchived ?? null,
        })),
      },
      criteria: review.criteria.map((c) => ({ code: criterionCode(review, c.id), kind: c.kind, element: c.element, stages: c.stages, text: c.text, ...(c.kind === 'paired' ? { excludeText: c.excludeText || '' } : {}) })),
    },
    reviewers: reviewers.map((rv) => ({ id: rv.id, name: rv.name, type: rv.type, model: rv.model || '', assignment: rv.assignment })),
    searches: review.runs.map((r, i) => ({
      database: r.database, platform: r.platform, sourceType: r.sourceType || 'database', stream: r.stream || '', variant: r.variant || '',
      dateRun: r.dateRun, dateRange: r.dateRange, searchString: r.searchString, fields: r.fields, filters: r.filters,
      reportedHits: r.reportedHits, imported: prisma.perRun[i]?.imported ?? 0,
    })),
    prisma,
    agreement,
    codebook: review.codebook.map((c) => ({ id: c.id, label: c.label, group: c.group || '', definition: c.description || '', origin: c.origin || 'a-priori' })),
    chartingFields: fields.map((f, i) => ({ key: keys[i], label: f.label, type: f.type, options: (f.options || []).map((o) => o.trim()).filter(Boolean) })),
    appraisalTool: tool ? { tool: tool.tool, label: tool.label, items: tool.items.map((it) => ({ id: it.id, label: it.label })), scale: tool.scale, overall: tool.overall } : null,
    included,
    excludedFullText,
  };
}
