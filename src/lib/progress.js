// Where a review stands: one status per review step, shared by the sidebar and the overview so they never disagree.
import { prismaCounts } from './prisma.js';
import { appraisalPool, codingPool, decisionsOf, finalAppraisal, finalCoding, finalDecision, ftPool, isAssigned, isHuman, uniqueRecords } from './model.js';
import { frameworkElements, frameworkValues, profileOf, reviewSettings } from './methods.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Human reviewers' assigned-but-undecided work in a stage. A stage is not complete while any exists:
// otherwise a record decided by one reviewer looks final, and the step would flip back to unfinished
// (or into a conflict) once the second reviewer gets to it.
//   missing  – assigned decisions not made yet (gates "done")
//   awaiting – records that already look decided but still wait for another assigned reviewer (shown as a note)
function outstanding(review, stage, pool, looksDecided) {
  const humans = (review.reviewers || []).filter(isHuman).map((rv) => ({ rv, d: decisionsOf(review, rv.id) }));
  let missing = 0;
  let awaiting = 0;
  for (const r of pool) {
    let waiting = false;
    for (const { rv, d } of humans) {
      if (!isAssigned(rv, stage, r.id)) continue;
      const decided = stage === 'coding' || stage === 'appraisal' ? d[stage]?.[r.id]?.done : d.screening?.[stage]?.[r.id];
      if (!decided) { missing += 1; waiting = true; }
    }
    if (waiting && looksDecided(r.id)) awaiting += 1;
  }
  return { missing, awaiting };
}

export function reviewStages(review) {
  const c = prismaCounts(review);
  const p = review.protocol;
  const coding = codingPool(review).map((r) => finalCoding(review, r.id).status);
  const coded = coding.filter((s) => s !== 'pending' && s !== 'conflict').length;
  const codingConflicts = coding.filter((s) => s === 'conflict').length;
  const settings = reviewSettings(review);
  const appraisal = settings.appraisal ? appraisalPool(review).map((r) => finalAppraisal(review, r.id).status) : [];
  const appraised = appraisal.filter((s) => s !== 'pending' && s !== 'conflict').length;
  const appraisalConflicts = appraisal.filter((s) => s === 'conflict').length;
  const conflicts = c.taConflicts + c.ftConflicts + codingConflicts + appraisalConflicts;
  const screened = (stage) => (id) => !!finalDecision(review, stage, id).decision;
  const open = {
    ta: outstanding(review, 'ta', uniqueRecords(review), screened('ta')),
    ft: outstanding(review, 'ft', ftPool(review), screened('ft')),
    coding: outstanding(review, 'coding', codingPool(review), (id) => !['pending', 'conflict'].includes(finalCoding(review, id).status)),
    appraisal: settings.appraisal ? outstanding(review, 'appraisal', appraisalPool(review), (id) => !['pending', 'conflict'].includes(finalAppraisal(review, id).status)) : { missing: 0, awaiting: 0 },
  };
  // Progress bars count a record only once it is settled: decided AND no assigned human reviewer is still
  // missing on it. Otherwise the bar would read 100% while the step still waits for the second reviewer.
  const openNote = (o) => (o.awaiting ? ` · ${o.awaiting} still awaiting a second reviewer` : '');

  // Screening is a chain: a step only counts as complete once everything before it is complete,
  // because unfinished upstream work can still send new records into it.
  const recordsDone = c.unique > 0;
  const taDone = recordsDone && c.taPending === 0 && open.ta.missing === 0;
  const ftDone = taDone && c.sought > 0 && c.ftPending === 0 && open.ft.missing === 0;
  const codingDone = ftDone && coding.length > 0 && coded === coding.length && open.coding.missing === 0;
  const appraisalDone = ftDone && appraisal.length > 0 && appraised === appraisal.length && open.appraisal.missing === 0;

  const values = frameworkValues(review);
  const elements = frameworkElements(review);
  const protoMissing = [
    !p.objective && 'objective',
    ...elements.filter(([k]) => !(values[k] || '').trim()).map(([, label]) => label.toLowerCase()),
    !elements.length && 'framework elements (settings)',
    // Paired criteria carry both an inclusion and an exclusion side.
    !review.criteria.some((x) => x.kind === 'inclusion' || x.kind === 'paired') && 'inclusion criteria',
    !review.criteria.some((x) => x.kind === 'exclusion' || x.kind === 'paired') && 'exclusion criteria',
  ].filter(Boolean);
  const protoTotal = 3 + Math.max(elements.length, 1);
  const fwShort = (reviewSettings(review).framework || '').toUpperCase();
  const runsReady = review.runs.filter((r) => r.searchString && r.imports.length).length;

  const steps = [
    {
      key: 'protocol', to: 'protocol', label: 'Protocol & criteria', group: 'plan',
      done: protoMissing.length === 0,
      progress: { value: protoTotal - protoMissing.length, total: protoTotal },
      detail: protoMissing.length ? `Missing: ${protoMissing.join(', ')}` : `Objective, ${fwShort === 'CUSTOM' ? 'eligibility framework' : fwShort} and criteria defined`,
    },
    {
      key: 'searches', to: 'searches', label: 'Searches & import', group: 'plan',
      done: review.runs.length > 0 && runsReady === review.runs.length,
      progress: review.runs.length ? { value: runsReady, total: review.runs.length } : null,
      detail: review.runs.length
        ? `${plural(review.runs.length, 'search run')}, ${runsReady} documented with imported results`
        : 'No search runs documented yet',
    },
    {
      key: 'records', to: 'records', label: 'Records & duplicates', group: 'screening',
      done: recordsDone,
      detail: c.identified
        ? `${c.identified} identified · ${c.duplicates} duplicates removed · ${c.unique} to screen`
        : 'Nothing imported yet',
    },
    {
      key: 'ta', to: 'screen/ta', label: 'Title / abstract screening', group: 'screening',
      done: taDone,
      progress: c.unique ? { value: c.taScreened - open.ta.awaiting, total: c.unique } : null,
      detail: c.unique
        ? `${c.taScreened} of ${c.unique} decided · ${c.taInclude + c.taUnclear} forwarded · ${c.taExcluded} excluded${c.taConflicts ? ` · ${plural(c.taConflicts, 'conflict')}` : ''}${openNote(open.ta)}`
        : 'Waiting for imported records',
      attention: c.taConflicts || 0,
    },
    {
      key: 'ft', to: 'screen/ft', label: 'Full-text screening', group: 'screening',
      done: ftDone,
      progress: c.sought ? { value: c.assessed + c.notRetrieved - open.ft.awaiting, total: c.sought } : null,
      detail: c.sought
        ? `${c.assessed + c.notRetrieved} of ${c.sought} decided · ${c.ftIncluded} included · ${c.ftExcluded} excluded · ${c.notRetrieved} not retrievable${c.ftConflicts ? ` · ${plural(c.ftConflicts, 'conflict')}` : ''}${openNote(open.ft)}${!taDone ? ' · more may arrive from title / abstract' : ''}`
        : 'Waiting for records forwarded from title / abstract',
      attention: c.ftConflicts || 0,
    },
    {
      key: 'coding', to: 'code', label: 'Extraction & coding', group: 'analysis',
      done: codingDone,
      progress: coding.length ? { value: coded - open.coding.awaiting, total: coding.length } : null,
      detail: coding.length
        ? `${coded} of ${coding.length} included sources coded${codingConflicts ? ` · ${plural(codingConflicts, 'conflict')}` : ''}${openNote(open.coding)}${!ftDone ? ' · more may arrive from full text' : ''}`
        : 'Waiting for included full texts',
      attention: codingConflicts,
    },
    ...(settings.appraisal ? [{
      key: 'appraisal', to: 'appraise', label: 'Critical appraisal', group: 'analysis',
      done: appraisalDone,
      progress: appraisal.length ? { value: appraised - open.appraisal.awaiting, total: appraisal.length } : null,
      detail: appraisal.length
        ? `${appraised} of ${appraisal.length} included sources appraised${appraisalConflicts ? ` · ${plural(appraisalConflicts, 'conflict')}` : ''}${openNote(open.appraisal)}${!ftDone ? ' · more may arrive from full text' : ''}`
        : 'Waiting for included full texts',
      attention: appraisalConflicts,
    }] : []),
    {
      key: 'compare', to: 'compare', label: 'Compare & consensus', group: 'analysis',
      done: taDone && conflicts === 0,
      detail: conflicts ? `${plural(conflicts, 'open conflict')} between reviewers` : c.taScreened ? 'No open conflicts' : 'Nothing to compare yet',
      attention: conflicts,
      side: true, // runs alongside the screening steps rather than after them
    },
    {
      key: 'results', to: 'results', label: 'Results & analysis', group: 'analysis',
      done: false,
      detail: c.ftIncluded ? `Charts, evidence map and networks of ${plural(c.ftIncluded, 'included source')}` : 'Keyword maps of all records; code maps once sources are included',
      side: true,
    },
    {
      key: 'export', to: 'export', label: 'Export', group: 'analysis',
      done: false,
      detail: c.ftIncluded ? `${plural(c.ftIncluded, 'included source')} ready to report (${profileOf(review).guideline})` : 'Available once sources are included',
      side: true,
    },
  ];

  // Current step: where work is actually happening, i.e. the furthest unfinished step that has started.
  // If nothing is in progress, the first unfinished step. Unfinished steps before it are reported as gaps.
  const linear = steps.filter((s) => !s.side);
  const started = linear.filter((s) => !s.done && s.progress?.value > 0);
  const current = started[started.length - 1] || linear.find((s) => !s.done) || steps.find((s) => s.key === 'export');
  const gaps = linear.slice(0, linear.indexOf(current)).filter((s) => !s.done);
  return { steps, current, gaps, counts: c, conflicts };
}
