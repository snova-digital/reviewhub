// Analysis of the review's findings: datasets, dimensions for cross-tabulation (evidence maps),
// co-occurrence networks (codes, keywords, co-authorship) and VOSviewer export.
// Everything works on FINAL values (consensus, or agreement of the human reviewers).
import { codingPool, finalAppraisal, finalField, ftPool, settledCodes, uniqueRecords } from './model.js';

export const DATASETS = [
  { value: 'included', label: 'Included sources', hint: 'Final full-text include: codes, charting fields and appraisal available.' },
  { value: 'fulltext', label: 'Full-text pool', hint: 'Everything forwarded from title / abstract screening.' },
  { value: 'all', label: 'All unique records', hint: 'The whole deduplicated search result: useful for keyword and author maps of the field.' },
];

export function datasetRecords(review, key) {
  if (key === 'all') return uniqueRecords(review);
  if (key === 'fulltext') return ftPool(review);
  return codingPool(review);
}

const normKw = (k) => k.toLowerCase().replace(/\s+/g, ' ').trim();
// "Doe, Jane A." / "Jane A. Doe" → "Doe, J."
export function normAuthor(a) {
  const s = (a || '').trim();
  if (!s) return '';
  let last; let first;
  if (s.includes(',')) [last, first] = s.split(',').map((x) => x.trim());
  else { const parts = s.split(/\s+/); last = parts.pop(); first = parts.join(' '); }
  const ini = (first || '').split(/[\s.-]+/).filter(Boolean).map((x) => `${x[0].toUpperCase()}.`).join('');
  return `${last}${ini ? `, ${ini}` : ''}`;
}

// ---- dimensions --------------------------------------------------------------------------
// A dimension maps a record to zero or more category labels. Multi-valued dimensions (codes, keywords)
// count a record once in each of its categories.
export function dimensions(review) {
  const codeName = Object.fromEntries(review.codebook.map((c) => [c.id, c.label]));
  const codeGroup = Object.fromEntries(review.codebook.map((c) => [c.id, c.group || 'Ungrouped']));
  const groups = [...new Set(review.codebook.map((c) => c.group || 'Ungrouped'))];
  const runDb = Object.fromEntries(review.runs.map((r) => [r.id, r.database || '(unnamed)']));
  const tool = review.appraisalTool;
  const dims = [
    { key: 'year', label: 'Publication year', order: 'value', values: (r) => (r.year ? [r.year] : ['n/a']) },
    { key: 'source', label: 'Database', values: (r) => [runDb[r.runId] || 'n/a'] },
    { key: 'journal', label: 'Journal / venue (top 15)', top: 15, values: (r) => (r.journal ? [r.journal] : []) },
    { key: 'keyword', label: 'Keyword (top 20)', top: 20, values: (r) => [...new Set((r.keywords || []).map(normKw))] },
    { key: 'codes', label: 'Code (all groups)', needsCoding: true, order: 'codebook', values: (r) => settledCodes(review, r.id).map((id) => codeName[id]).filter(Boolean), orderList: review.codebook.map((c) => c.label) },
    ...groups.map((g) => ({
      key: `group:${g}`, label: `Codes: ${g}`, needsCoding: true, order: 'codebook', orderList: review.codebook.filter((c) => (c.group || 'Ungrouped') === g).map((c) => c.label),
      values: (r) => settledCodes(review, r.id).filter((id) => codeGroup[id] === g).map((id) => codeName[id]).filter(Boolean),
    })),
    ...(review.chartingForm || []).filter((f) => ['select', 'multiselect', 'yesno', 'text', 'number'].includes(f.type)).map((f) => ({
      key: `field:${f.id}`, label: `Field: ${f.label}`, needsCoding: true, top: f.type === 'text' ? 20 : null,
      order: f.type === 'number' ? 'value' : f.options?.length ? 'codebook' : 'count', orderList: (f.options || []).map((o) => o.trim()).filter(Boolean),
      values: (r) => { const v = finalField(review, r.id, f.id).value; return v == null || v === '' ? [] : Array.isArray(v) ? v : [String(v)]; },
    })),
    ...(tool ? [{ key: 'appraisal', label: `Appraisal: overall (${tool.label})`, needsCoding: true, order: 'codebook', orderList: tool.overall.map((s) => s.label),
      values: (r) => { const a = finalAppraisal(review, r.id); const s = tool.overall.find((x) => x.value === a.overall); return s ? [s.label] : []; } }] : []),
  ];
  return dims;
}

// Category counts of one dimension: [{ label, ids: [...] }], ordered and trimmed.
export function tally(records, dim) {
  const m = new Map();
  for (const r of records) for (const v of dim.values(r)) { if (!m.has(v)) m.set(v, []); m.get(v).push(r.id); }
  let out = [...m.entries()].map(([label, ids]) => ({ label, ids }));
  if (dim.order === 'value') out.sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
  else if (dim.order === 'codebook') {
    const pos = new Map((dim.orderList || []).map((l, i) => [l, i]));
    out.sort((a, b) => (pos.get(a.label) ?? 1e9) - (pos.get(b.label) ?? 1e9) || b.ids.length - a.ids.length);
  } else out.sort((a, b) => b.ids.length - a.ids.length || a.label.localeCompare(b.label));
  if (dim.top) {
    if (dim.order === 'value') out = out.filter((x) => [...out].sort((a, b) => b.ids.length - a.ids.length).slice(0, dim.top).includes(x));
    else out = out.slice(0, dim.top);
  }
  return out;
}

// Cross-tabulation (evidence map): rows × cols, each cell holding the record ids in both categories.
export function crosstab(records, rowDim, colDim) {
  const rows = tally(records, rowDim);
  const cols = tally(records, colDim);
  const colIndex = new Map(cols.map((c, i) => [c.label, i]));
  const cells = rows.map((row) => {
    const inRow = new Set(row.ids);
    const line = cols.map(() => []);
    for (const r of records) {
      if (!inRow.has(r.id)) continue;
      for (const v of new Set(colDim.values(r))) { const j = colIndex.get(v); if (j !== undefined) line[j].push(r.id); }
    }
    return line;
  });
  return { rows, cols, cells };
}

// ---- co-occurrence networks ------------------------------------------------------------------
export const NETWORKS = [
  { value: 'codes', label: 'Code co-occurrence', hint: 'Codes applied to the same source. Clusters = code groups.', needsCoding: true },
  { value: 'keywords', label: 'Keyword co-occurrence', hint: 'Author keywords appearing together. Clusters are detected automatically.' },
  { value: 'authors', label: 'Co-authorship', hint: 'Authors who published together. Clusters are detected automatically.' },
  { value: 'fields', label: 'Codes × charting values', hint: 'Codes and charting-form values (select fields) appearing on the same source.', needsCoding: true },
];

function itemsOf(review, kind) {
  const codeById = Object.fromEntries(review.codebook.map((c) => [c.id, c]));
  const selectFields = (review.chartingForm || []).filter((f) => ['select', 'multiselect', 'yesno'].includes(f.type));
  return (r) => {
    if (kind === 'codes') return settledCodes(review, r.id).filter((id) => codeById[id]).map((id) => ({ key: id, label: codeById[id].label, group: codeById[id].group || 'Ungrouped' }));
    if (kind === 'keywords') return [...new Set((r.keywords || []).map(normKw))].filter(Boolean).map((k) => ({ key: k, label: k }));
    if (kind === 'authors') return [...new Set((r.authors || []).map(normAuthor))].filter(Boolean).map((a) => ({ key: a, label: a }));
    if (kind === 'fields') {
      const codes = settledCodes(review, r.id).filter((id) => codeById[id]).map((id) => ({ key: id, label: codeById[id].label, group: codeById[id].group || 'Ungrouped' }));
      const vals = selectFields.flatMap((f) => {
        const v = finalField(review, r.id, f.id).value;
        return (Array.isArray(v) ? v : v ? [v] : []).map((x) => ({ key: `${f.id}:${x}`, label: `${f.label}: ${x}`, group: f.label }));
      });
      return [...codes, ...vals];
    }
    return [];
  };
}

// Build a network. Nodes: items with ≥ minOcc occurrences (top maxNodes); links: pairs co-occurring ≥ minLink times.
export function buildNetwork(review, records, kind, { minOcc = 1, minLink = 1, maxNodes = 150 } = {}) {
  const items = itemsOf(review, kind);
  const nodes = new Map();
  const perRecord = [];
  for (const r of records) {
    const its = items(r);
    perRecord.push({ id: r.id, keys: its.map((x) => x.key) });
    for (const it of its) {
      if (!nodes.has(it.key)) nodes.set(it.key, { ...it, id: it.key, ids: [] });
      nodes.get(it.key).ids.push(r.id);
    }
  }
  const kept = [...nodes.values()].filter((n) => n.ids.length >= minOcc).sort((a, b) => b.ids.length - a.ids.length || a.label.localeCompare(b.label)).slice(0, maxNodes);
  const keep = new Set(kept.map((n) => n.id));
  const links = new Map();
  for (const { id, keys } of perRecord) {
    const ks = keys.filter((k) => keep.has(k)).sort();
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const k = `${ks[i]}\u0000${ks[j]}`;
      if (!links.has(k)) links.set(k, { source: ks[i], target: ks[j], ids: [] });
      links.get(k).ids.push(id);
    }
  }
  const linkList = [...links.values()].filter((l) => l.ids.length >= minLink).map((l) => ({ ...l, weight: l.ids.length }));
  for (const n of kept) {
    n.occurrences = n.ids.length;
    n.links = linkList.filter((l) => l.source === n.id || l.target === n.id).length;
    n.strength = linkList.filter((l) => l.source === n.id || l.target === n.id).reduce((s, l) => s + l.weight, 0);
  }
  const grouped = kept.some((n) => n.group);
  const clusters = grouped ? clusterByGroup(kept) : detectClusters(kept, linkList);
  return { nodes: kept, links: linkList, clusters };
}

function clusterByGroup(nodes) {
  const groups = [...new Set(nodes.map((n) => n.group))];
  // Largest groups get the first (most distinct) colours.
  groups.sort((a, b) => nodes.filter((n) => n.group === b).length - nodes.filter((n) => n.group === a).length);
  for (const n of nodes) n.cluster = groups.indexOf(n.group) + 1;
  return groups.map((g, i) => ({ id: i + 1, label: g, size: nodes.filter((n) => n.group === g).length }));
}

// Louvain modularity clustering (deterministic node order) on association-strength normalised links, as in
// VOSviewer: a_ij = c_ij / (o_i · o_j), so ubiquitous terms (e.g. the search topic itself) do not pull every
// node into one cluster. Clusters are renumbered by size (1 = largest).
function louvain(n, edges, resolution = 1) {
  let assignment = Array.from({ length: n }, (_, i) => i);
  let N = n; let E = edges;
  for (let level = 0; level < 12; level++) {
    const adj = Array.from({ length: N }, () => new Map());
    const k = new Array(N).fill(0);
    for (const [i, j, w] of E) {
      if (i === j) { k[i] += 2 * w; continue; }
      adj[i].set(j, (adj[i].get(j) || 0) + w); adj[j].set(i, (adj[j].get(i) || 0) + w);
      k[i] += w; k[j] += w;
    }
    const m2 = k.reduce((s, x) => s + x, 0);
    if (!m2) break;
    const c = Array.from({ length: N }, (_, i) => i);
    const tot = [...k];
    let improved = false;
    for (let pass = 0, moved = true; moved && pass < 50; pass++) {
      moved = false;
      for (let i = 0; i < N; i++) {
        const ci = c[i];
        const wsum = new Map();
        for (const [j, w] of adj[i]) wsum.set(c[j], (wsum.get(c[j]) || 0) + w);
        tot[ci] -= k[i];
        let best = ci; let bestGain = (wsum.get(ci) || 0) - (resolution * tot[ci] * k[i]) / m2;
        for (const [d, w] of wsum) {
          const gain = w - (resolution * tot[d] * k[i]) / m2;
          if (gain > bestGain + 1e-12 || (Math.abs(gain - bestGain) <= 1e-12 && d < best)) { best = d; bestGain = gain; }
        }
        tot[best] += k[i];
        if (best !== ci) { c[i] = best; moved = true; improved = true; }
      }
    }
    if (!improved) break;
    const ids = new Map();
    for (const x of c) if (!ids.has(x)) ids.set(x, ids.size);
    const agg = new Map();
    for (const [i, j, w] of E) {
      const a = ids.get(c[i]); const b = ids.get(c[j]);
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      agg.set(key, (agg.get(key) || 0) + w);
    }
    E = [...agg.entries()].map(([key, w]) => { const [a, b] = key.split(',').map(Number); return [a, b, w]; });
    assignment = assignment.map((a) => ids.get(c[a]));
    N = ids.size;
  }
  return assignment;
}

function detectClusters(nodes, links) {
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const occ = nodes.map((n) => n.occurrences || n.ids.length);
  const edges = links.map((l) => { const i = idx.get(l.source); const j = idx.get(l.target); return [i, j, l.weight / (occ[i] * occ[j])]; });
  const scale = Math.max(...edges.map((e) => e[2]), 0) || 1;
  const comm = louvain(nodes.length, edges.map(([i, j, w]) => [i, j, w / scale]));
  const label = new Map(nodes.map((n, i) => [n.id, comm[i]]));
  const sizes = new Map();
  for (const n of nodes) sizes.set(label.get(n.id), (sizes.get(label.get(n.id)) || 0) + 1);
  const order = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([cl]) => cl);
  for (const n of nodes) n.cluster = order.indexOf(label.get(n.id)) + 1;
  return order.map((c, i) => {
    const members = nodes.filter((n) => n.cluster === i + 1);
    return { id: i + 1, label: `Cluster ${i + 1}: ${members.slice(0, 2).map((m) => m.label).join(', ')}${members.length > 2 ? ', …' : ''}`, size: members.length };
  });
}

// ---- VOSviewer export --------------------------------------------------------------------------
// Map file + network file (VOSviewer → Create map → "Create a map based on network data").
// Coordinates are left out, so VOSviewer computes its own layout and clustering if wanted.
export function vosviewerFiles(net) {
  const idOf = new Map(net.nodes.map((n, i) => [n.id, i + 1]));
  const clean = (s) => String(s).replace(/[\t\r\n]+/g, ' ');
  const map = ['id\tlabel\tcluster\tweight<Links>\tweight<Total link strength>\tweight<Occurrences>',
    ...net.nodes.map((n) => [idOf.get(n.id), clean(n.label), n.cluster, n.links, n.strength, n.occurrences].join('\t'))].join('\n');
  const network = net.links.map((l) => [idOf.get(l.source), idOf.get(l.target), l.weight].join('\t')).join('\n');
  return { map, network };
}
