// Parsers for common bibliographic database export formats.
// Every parser returns an array of normalised entries:
// { title, abstract, keywords[], authors[], year, journal, doi, url, type, pdfHint }
import Papa from 'papaparse';

const clean = (s) => (s ?? '').toString().replace(/\s+/g, ' ').trim();
const normDoi = (s) => {
  const m = clean(s).match(/10\.\d{4,9}\/[^\s"<>]+/i);
  return m ? m[0].replace(/[.,;]+$/, '').toLowerCase() : '';
};
const splitKw = (s) =>
  clean(s).split(/\s*[;|]\s*|\s*,\s*(?=[^,]{2,})/).map(clean).filter(Boolean);
const yearOf = (s) => (clean(s).match(/\b(1[89]\d\d|20\d\d)\b/) || [])[1] || '';
const uniq = (a) => [...new Set(a)];

function finish(e) {
  return {
    title: clean(e.title).replace(/^\{|\}$/g, ''),
    abstract: clean(e.abstract),
    keywords: uniq((e.keywords || []).flatMap(splitKw)),
    authors: (e.authors || []).map(clean).filter(Boolean),
    year: yearOf(e.year),
    journal: clean(e.journal),
    doi: normDoi(e.doi) || normDoi(e.url),
    url: clean(e.url),
    type: clean(e.type),
    pdfHint: clean(e.pdfHint),
  };
}

// ---- RIS (Scopus, WoS, EBSCO, ProQuest, Zotero, Mendeley, EndNote) ----------
export function parseRIS(text) {
  const out = [];
  let cur = null;
  let lastTag = null;
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^([A-Z][A-Z0-9])\s{1,2}-\s?(.*)$/);
    if (!m) {
      if (cur && lastTag && raw.trim()) cur[lastTag].push(cur[lastTag].pop() + ' ' + raw.trim());
      continue;
    }
    const [, tag, val] = m;
    if (tag === 'TY') { cur = { TY: [val] }; lastTag = 'TY'; continue; }
    if (tag === 'ER') { if (cur) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    (cur[tag] ||= []).push(val);
    lastTag = tag;
  }
  if (cur) out.push(cur);
  const f = (r, ...tags) => tags.map((t) => r[t]?.[0]).find(Boolean) || '';
  return out.map((r) => finish({
    title: f(r, 'TI', 'T1', 'CT'),
    abstract: (r.AB || r.N2 || []).join(' '),
    keywords: r.KW || [],
    authors: r.AU || r.A1 || r.A2 || [],
    year: f(r, 'PY', 'Y1', 'DA'),
    journal: f(r, 'T2', 'JO', 'JF', 'JA', 'BT'),
    doi: f(r, 'DO') || (r.M3 || []).join(' '),
    url: f(r, 'UR', 'L2'),
    type: f(r, 'TY'),
    pdfHint: (r.L1 || []).find((x) => /\.pdf$/i.test(x)) || '',
  }));
}

// ---- BibTeX (ACM DL, IEEE, Google Scholar, Zotero/JabRef/Better BibTeX) ------
export function parseBibTeX(text) {
  const out = [];
  let i = 0;
  while ((i = text.indexOf('@', i)) !== -1) {
    const head = text.slice(i).match(/^@(\w+)\s*([{(])/);
    if (!head) { i++; continue; }
    const type = head[1].toLowerCase();
    let j = i + head[0].length;
    if (['comment', 'preamble', 'string'].includes(type)) { i = j; continue; }
    // find matching close brace
    let depth = 1, k = j;
    while (k < text.length && depth > 0) {
      const ch = text[k];
      if (ch === '{' || ch === '(') depth++;
      else if (ch === '}' || ch === ')') depth--;
      k++;
    }
    const body = text.slice(j, k - 1);
    i = k;
    const comma = body.indexOf(',');
    const fields = {};
    let p = comma + 1;
    while (p < body.length) {
      const fm = body.slice(p).match(/^\s*([\w-]+)\s*=\s*/);
      if (!fm) break;
      const name = fm[1].toLowerCase();
      p += fm[0].length;
      let val = '';
      if (body[p] === '{') {
        let d = 1, q = p + 1;
        while (q < body.length && d > 0) { if (body[q] === '{') d++; else if (body[q] === '}') d--; q++; }
        val = body.slice(p + 1, q - 1); p = q;
      } else if (body[p] === '"') {
        let q = p + 1;
        while (q < body.length && !(body[q] === '"' && body[q - 1] !== '\\')) q++;
        val = body.slice(p + 1, q); p = q + 1;
      } else {
        const vm = body.slice(p).match(/^[^,]*/); val = vm[0]; p += vm[0].length;
      }
      fields[name] = val.replace(/[{}]/g, '').replace(/\\(["'`^~&%$#_])/g, '$1');
      const next = body.slice(p).match(/^\s*,?/); p += next[0].length;
    }
    const pdf = (fields.file || '').split(/;/).map((s) => s.split(':').find((x) => /\.pdf$/i.test(x)) || '').find(Boolean);
    out.push(finish({
      title: fields.title,
      abstract: fields.abstract,
      keywords: [fields.keywords || fields.author_keywords || ''],
      authors: (fields.author || '').split(/\s+and\s+/i),
      year: fields.year || fields.date,
      journal: fields.journal || fields.booktitle || fields.journaltitle || fields.publisher,
      doi: fields.doi,
      url: fields.url,
      type,
      pdfHint: pdf || '',
    }));
  }
  return out;
}

// ---- PubMed MEDLINE (.nbib / .txt) -------------------------------------------
export function parseMEDLINE(text) {
  const out = [];
  let cur = null, lastTag = null;
  const flush = () => { if (cur && Object.keys(cur).length) out.push(cur); cur = null; };
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) { continue; }
    const m = raw.match(/^([A-Z]{2,4})\s*-\s(.*)$/);
    if (m) {
      if (m[1] === 'PMID') { flush(); cur = {}; }
      if (!cur) cur = {};
      (cur[m[1]] ||= []).push(m[2]);
      lastTag = m[1];
    } else if (cur && lastTag && /^\s{2,}/.test(raw)) {
      cur[lastTag].push(cur[lastTag].pop() + ' ' + raw.trim());
    }
  }
  flush();
  return out.map((r) => finish({
    title: (r.TI || r.BTI || [])[0],
    abstract: (r.AB || []).join(' '),
    keywords: [...(r.OT || []), ...(r.MH || []).map((x) => x.replace(/\/.*$/, '').replace(/^\*/, ''))],
    authors: r.FAU || r.AU || [],
    year: (r.DP || [])[0],
    journal: (r.JT || r.TA || [])[0],
    doi: [...(r.LID || []), ...(r.AID || [])].find((x) => /\[doi\]/.test(x)) || '',
    url: r.PMID ? `https://pubmed.ncbi.nlm.nih.gov/${r.PMID[0]}/` : '',
    type: (r.PT || [])[0],
  }));
}

// ---- Web of Science plain text (FN … ER / EF) -------------------------------
export function parseWoSText(text) {
  const out = [];
  let cur = null, lastTag = null;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = raw.match(/^([A-Z][A-Z0-9])(?:\s(.*))?$/);
    if (m && !raw.startsWith('   ')) {
      const [, tag, val] = m;
      if (tag === 'PT') { cur = {}; }
      if (tag === 'ER') { if (cur) out.push(cur); cur = null; continue; }
      if (!cur) continue;
      (cur[tag] ||= []).push(val ?? ''); lastTag = tag;
    } else if (cur && lastTag && raw.startsWith('   ')) {
      cur[lastTag].push(raw.trim());
    }
  }
  return out.map((r) => finish({
    title: (r.TI || []).join(' '),
    abstract: (r.AB || []).join(' '),
    keywords: [(r.DE || []).join(' '), (r.ID || []).join(' ')],
    authors: r.AF || r.AU || [],
    year: (r.PY || [])[0],
    journal: (r.SO || []).join(' '),
    doi: (r.DI || [])[0],
    url: r.UT ? `https://www.webofscience.com/wos/woscc/full-record/${r.UT[0]}` : '',
    type: (r.DT || [])[0],
  }));
}

// ---- CSV / TSV (Scopus CSV, WoS tab-delimited, IEEE Xplore CSV, generic) ----
const COLS = {
  title: ['title', 'document title', 'article title', 'ti', 'item title', 'publication title (article)'],
  abstract: ['abstract', 'ab', 'description'],
  keywords: ['author keywords', 'keywords', 'de', 'index keywords', 'ieee terms', 'id', 'keywords plus', 'mesh terms', 'manual tags', 'automatic tags'],
  authors: ['authors', 'author', 'au', 'author full names', 'af'],
  year: ['year', 'publication year', 'py', 'date', 'pubdate'],
  journal: ['source title', 'publication title', 'journal', 'so', 'source', 'journal/book'],
  doi: ['doi', 'di'],
  url: ['link', 'url', 'pdf link', 'article url'],
  type: ['document type', 'dt', 'item type', 'type'],
  pdfHint: ['file attachments', 'pdf', 'file'],
};

export function parseCSV(text) {
  const res = Papa.parse(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true });
  const headers = res.meta.fields || [];
  const find = (names) => names.map((n) => headers.find((h) => h.trim().toLowerCase() === n)).filter(Boolean);
  const map = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, find(names)]));
  return res.data.map((row) => {
    const g = (k) => map[k].map((h) => row[h]).find((v) => clean(v)) || '';
    const authors = g('authors');
    return finish({
      title: g('title'),
      abstract: g('abstract').replace(/^\[No abstract available\]$/i, ''),
      keywords: map.keywords.map((h) => row[h]).filter(Boolean),
      authors: authors.includes(';') ? authors.split(';') : [authors],
      year: g('year'),
      journal: g('journal'),
      doi: g('doi'),
      url: g('url'),
      type: g('type'),
      pdfHint: (g('pdfHint').split(';').find((x) => /\.pdf$/i.test(x.trim())) || '').trim(),
    });
  }).filter((e) => e.title);
}

export const FORMATS = {
  ris: { label: 'RIS', parse: parseRIS },
  bib: { label: 'BibTeX', parse: parseBibTeX },
  medline: { label: 'PubMed MEDLINE', parse: parseMEDLINE },
  wos: { label: 'Web of Science plain text', parse: parseWoSText },
  csv: { label: 'CSV / TSV', parse: parseCSV },
};

export function detectFormat(name, text) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const head = text.slice(0, 2000).replace(/^\uFEFF/, '');
  if (ext === 'ris' || /^TY\s{1,2}-/m.test(head)) return 'ris';
  if (ext === 'bib' || /^\s*@\w+\s*\{/m.test(head)) return 'bib';
  if (ext === 'nbib' || /^PMID-\s/m.test(head)) return 'medline';
  if (/^FN\s/.test(head) || /^PT\s[JBSP]\s*$/m.test(head)) return 'wos';
  return 'csv';
}
