// PRISMA-ScR / PRISMA 2020 flow numbers derived from the review state.
import { criterionLabel, finalDecision, runLabel, studyKey, uniqueRecords } from './model.js';

// PRISMA 2020 separates databases/registers from other methods (websites, organisations, citation searching).
export const isOtherSource = (run) => run?.sourceType === 'other' || /citation|grey|website|organi[sz]ation|hand.?search/i.test(run?.database || '');

export function prismaCounts(review) {
  const perRun = review.runs.map((run) => ({
    id: run.id,
    database: runLabel(run),
    imported: review.records.filter((r) => r.runId === run.id).length,
    reported: run.reportedHits,
  }));
  // PRISMA reports identification per database/source, so aggregate the runs.
  const perDatabase = Object.values(review.runs.reduce((m, run) => {
    const k = run.database || '(unnamed)';
    m[k] ||= { id: k, database: k, imported: 0, reported: 0, hasReported: false };
    m[k].imported += review.records.filter((r) => r.runId === run.id).length;
    if (run.reportedHits != null && run.reportedHits !== '') { m[k].reported += Number(run.reportedHits); m[k].hasReported = true; }
    return m;
  }, {})).map((d) => ({ ...d, reported: d.hasReported ? d.reported : null }));
  const identified = review.records.length;
  const runById = Object.fromEntries(review.runs.map((r) => [r.id, r]));
  const identifiedOther = review.records.filter((r) => isOtherSource(runById[r.runId])).length;
  const duplicates = review.records.filter((r) => r.duplicateOf).length;
  const unique = uniqueRecords(review);
  // Final decisions: consensus, or agreement of the human reviewers. Open conflicts count as pending.
  const ta = Object.fromEntries(unique.map((r) => [r.id, finalDecision(review, 'ta', r.id)]));
  const taScreened = unique.filter((r) => ta[r.id].decision).length;
  const taConflicts = unique.filter((r) => ta[r.id].status === 'conflict').length;
  const taExcluded = unique.filter((r) => ta[r.id].decision === 'exclude').length;
  const taInclude = unique.filter((r) => ta[r.id].decision === 'include').length;
  const taUnclear = unique.filter((r) => ta[r.id].decision === 'unclear').length;
  const sought = taInclude + taUnclear;

  const pool = unique.filter((r) => ['include', 'unclear'].includes(ta[r.id].decision));
  const ft = Object.fromEntries(pool.map((r) => [r.id, finalDecision(review, 'ft', r.id)]));
  const ftConflicts = pool.filter((r) => ft[r.id].status === 'conflict').length;
  const notRetrieved = pool.filter((r) => ft[r.id].decision === 'not_retrieved').length;
  const ftExcludedRecs = pool.filter((r) => ft[r.id].decision === 'exclude');
  const includedRecs = pool.filter((r) => ft[r.id].decision === 'include');
  const ftIncluded = includedRecs.length;
  // Reports linked to the same study (record.studyOf) count once as a study.
  const studies = new Set(includedRecs.map(studyKey)).size;
  const assessed = ftExcludedRecs.length + ftIncluded;

  const reasons = {};
  for (const r of ftExcludedRecs) {
    const key = ft[r.id].reason ? criterionLabel(review, ft[r.id].reason) : 'No reason recorded';
    reasons[key] = (reasons[key] || 0) + 1;
  }

  return {
    perRun, perDatabase, identified, identifiedDatabases: identified - identifiedOther, identifiedOther, duplicates, unique: unique.length, studies,
    taScreened, taExcluded, taInclude, taUnclear, taPending: unique.length - taScreened, taConflicts, ftConflicts,
    sought, notRetrieved, assessed, ftExcluded: ftExcludedRecs.length, ftIncluded,
    ftPending: pool.length - notRetrieved - assessed,
    reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
  };
}
