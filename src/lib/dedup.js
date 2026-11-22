// Deduplication. Duplicates are kept but flagged (duplicateOf) so PRISMA counts stay traceable and reversible.
//   strict (default): same DOI, or identical normalised title (+ year within ±1 when both are known)
//   fuzzy:            additionally near-identical titles (Dice similarity of character bigrams ≥ 0.9) with
//                     compatible year and the same first-author surname. Flagged with dupBy 'fuzzy' and a score,
//                     so they can be checked on the Records page.

export const normTitle = (t) =>
  (t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

const FUZZY_MIN = 0.9;
const words = (t) => (t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
const bigrams = (s) => { const out = new Map(); for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); out.set(b, (out.get(b) || 0) + 1); } return out; };
function dice(a, b) {
  const A = bigrams(a); const B = bigrams(b);
  let inter = 0; let total = 0;
  for (const [k, n] of A) { inter += Math.min(n, B.get(k) || 0); total += n; }
  for (const n of B.values()) total += n;
  return total ? (2 * inter) / total : 0;
}
const surname = (r) => {
  const a = (r.authors?.[0] || '').trim();
  if (!a) return '';
  const last = a.includes(',') ? a.split(',')[0] : a.split(/\s+/).at(-1);
  return last.toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');
};
const yearsOk = (a, b) => !a.year || !b.year || Math.abs(Number(a.year) - Number(b.year)) <= 1;

export function buildIndex(records, mode = 'strict') {
  const index = { mode, byDoi: new Map(), byTitle: new Map(), byWord: new Map() };
  for (const r of records) if (!r.duplicateOf) addToIndex(index, r);
  return index;
}

export function findDuplicate(index, entry) {
  if (entry.doi && index.byDoi.has(entry.doi)) return { match: index.byDoi.get(entry.doi), by: 'DOI' };
  const nt = normTitle(entry.title);
  if (nt.length > 15 && index.byTitle.has(nt)) {
    const m = index.byTitle.get(nt);
    if (yearsOk(entry, m)) return { match: m, by: 'title' };
  }
  if (index.mode === 'fuzzy' && nt.length > 15) {
    // Candidates share at least half of the title's longer words (inverted index), then are scored.
    const ws = [...new Set(words(entry.title))];
    const hits = new Map();
    for (const w of ws) for (const r of index.byWord.get(w) || []) hits.set(r, (hits.get(r) || 0) + 1);
    let best = null;
    for (const [r, n] of hits) {
      if (n < Math.ceil(ws.length / 2) || !yearsOk(entry, r)) continue;
      const sa = surname(entry); const sb = surname(r);
      if (sa && sb && sa !== sb) continue;
      const score = dice(nt, normTitle(r.title));
      if (score >= FUZZY_MIN && (!best || score > best.score)) best = { match: r, by: 'fuzzy', score: Math.round(score * 100) / 100 };
    }
    if (best) return best;
  }
  return null;
}

export function addToIndex(index, r) {
  if (r.doi && !index.byDoi.has(r.doi)) index.byDoi.set(r.doi, r);
  const nt = normTitle(r.title);
  if (nt.length > 15 && !index.byTitle.has(nt)) index.byTitle.set(nt, r);
  if (index.mode === 'fuzzy') {
    index.byWord ||= new Map();
    for (const w of new Set(words(r.title))) { if (!index.byWord.has(w)) index.byWord.set(w, []); index.byWord.get(w).push(r); }
  }
}

// Re-derive duplicate flags for all records in import order.
// Respects manual overrides: r.notDuplicate === true keeps a record in the pool.
export function recomputeDuplicates(records, mode = 'strict') {
  const index = { mode, byDoi: new Map(), byTitle: new Map(), byWord: new Map() };
  return records.map((r) => {
    const hit = r.notDuplicate ? null : findDuplicate(index, r);
    if (hit) return { ...r, duplicateOf: hit.match.id, dupBy: hit.by, dupScore: hit.score ?? null };
    const out = { ...r, duplicateOf: null, dupBy: null, dupScore: null };
    addToIndex(index, out);
    return out;
  });
}
