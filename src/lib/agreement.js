// Inter-rater agreement for the comparison step: percent agreement and Cohen's kappa, per reviewer pair,
// per criterion (ticked vs. not ticked) and per code (applied vs. not applied).

export function cohen(pairs) {
  // pairs: [[a, b], ...] categorical ratings of the same items by two raters
  const n = pairs.length;
  if (!n) return { n: 0, agree: null, kappa: null };
  const agreeN = pairs.filter(([a, b]) => a === b).length;
  const po = agreeN / n;
  const cats = [...new Set(pairs.flat())];
  const pe = cats.reduce((s, c) => s + (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n), 0);
  const kappa = pe === 1 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe);
  return { n, agree: po, kappa };
}

// Landis & Koch (1977) bands, the usual reference in review methods papers.
export function kappaBand(k) {
  if (k == null) return '';
  if (k < 0) return 'poor';
  if (k <= 0.2) return 'slight';
  if (k <= 0.4) return 'fair';
  if (k <= 0.6) return 'moderate';
  if (k <= 0.8) return 'substantial';
  return 'almost perfect';
}

export const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
export const fmtK = (k) => (k == null ? '–' : k.toFixed(2));

// Decision maps for two reviewers over the same stage → overlap, decision kappa, binary (exclude vs. forward) kappa,
// per-criterion kappa and confusion matrix.
// `appliesTo(criterion, recordId)`: stream-specific criteria are only compared on the records they apply to.
export function comparePair(mapA, mapB, { criteria = [], ids = null, categories = [], stateOf = null, appliesTo = null } = {}) {
  const shared = Object.keys(mapA).filter((id) => mapB[id] && (!ids || ids.has(id)));
  const pairs = shared.map((id) => [mapA[id].decision, mapB[id].decision]);
  const binary = pairs.map(([a, b]) => [a === 'exclude' ? 'exclude' : 'forward', b === 'exclude' ? 'exclude' : 'forward']);
  // A criterion nobody ticked has trivial 100% agreement; report it as unused instead of κ = 1.
  // Ticked criteria: ticked vs. not. Paired criteria: meets / unclear / fails / not judged (needs `stateOf`).
  const perCriterion = criteria.map((c) => {
    const val = (d) => (c.kind === 'paired' && stateOf ? stateOf(d, c) || '' : d.checked?.includes(c.id) ? 1 : 0);
    const pr = shared.filter((id) => !appliesTo || appliesTo(c, id)).map((id) => [val(mapA[id]), val(mapB[id])]);
    return pr.some(([a, b]) => a || b) ? { criterion: c, used: true, ...cohen(pr) } : { criterion: c, used: false, n: pr.length, agree: null, kappa: null };
  });
  const matrix = categories.map((ca) => categories.map((cb) => pairs.filter(([a, b]) => a === ca && b === cb).length));
  return { shared, decision: cohen(pairs), binary: cohen(binary), perCriterion, matrix };
}

// Coding: for each code, did both coders apply it to the record?
export function compareCoding(codingA, codingB, codebook) {
  const shared = Object.keys(codingA).filter((id) => codingA[id]?.done && codingB[id]?.done);
  const perCode = codebook.map((code) => {
    const pr = shared.map((id) => [codingA[id].codes.includes(code.id) ? 1 : 0, codingB[id].codes.includes(code.id) ? 1 : 0]);
    return pr.some(([a, b]) => a || b) ? { code, used: true, ...cohen(pr) } : { code, used: false, n: pr.length, agree: null, kappa: null };
  });
  const exact = shared.filter((id) => [...codingA[id].codes].sort().join() === [...codingB[id].codes].sort().join()).length;
  return { shared, perCode, exact: shared.length ? exact / shared.length : null };
}
