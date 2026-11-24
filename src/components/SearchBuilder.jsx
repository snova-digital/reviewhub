// Search builder: shared term blocks (OR within a block, AND between blocks) → database-specific query strings.
// With search streams switched on, each query is a stream (e.g. one per review question, primary/supplementary).
// Stored in review.search = { blocks: [{id, label, terms}], queries: [{id, name, variant, blocks: [blockId]}], limits }.
import { useState } from 'react';
import { useReview } from '../lib/store.jsx';
import { newRun, STREAM_VARIANTS, uid } from '../lib/model.js';
import { Button, Card, Field, Input, Select, Textarea } from './ui.jsx';
import { ReadOnly } from './PlanLock.jsx';

const termsOf = (b) => (b.terms || '').split('\n').map((t) => t.trim()).filter(Boolean);
const or = (ts, f = (x) => x) => ts.map(f).join(' OR ');

// Per database: how a block is wrapped, how limits are written, and what to record as fields/platform.
export const SYNTAX = {
  Scopus: {
    platform: 'Elsevier Scopus (Advanced search)', fields: 'TITLE-ABS-KEY (title, abstract, keywords)',
    block: (ts) => `TITLE-ABS-KEY( ${or(ts)} )`,
    limits: ({ yearFrom, yearTo, language }) => [yearFrom && `PUBYEAR > ${Number(yearFrom) - 1}`, yearTo && `PUBYEAR < ${Number(yearTo) + 1}`, language && `LANGUAGE( ${language.toLowerCase()} )`],
  },
  'Web of Science Core Collection': {
    platform: 'Clarivate Web of Science (Advanced search)', fields: 'TS = Topic (title, abstract, author keywords, Keywords Plus)',
    block: (ts) => `TS=( ${or(ts)} )`,
    limits: ({ yearFrom, yearTo, language }) => [(yearFrom || yearTo) && `PY=(${yearFrom || 1900}-${yearTo || new Date().getFullYear()})`, language && `LA=(${language})`],
  },
  'PubMed / MEDLINE': {
    platform: 'PubMed', fields: '[tiab] title and abstract',
    block: (ts) => `( ${or(ts, (t) => `${t}[tiab]`)} )`,
    limits: ({ yearFrom, yearTo, language }) => [(yearFrom || yearTo) && `("${yearFrom || 1900}"[dp] : "${yearTo || 3000}"[dp])`, language && `${language.toLowerCase()}[lang]`],
  },
  'IEEE Xplore': {
    platform: 'IEEE Xplore (Command search)', fields: 'All Metadata',
    block: (ts) => `( ${or(ts, (t) => `"All Metadata":${t}`)} )`,
    limits: () => [],
    note: 'Set year and language limits with the IEEE Xplore filters; IEEE allows at most 10 wildcards per search.',
  },
  'Generic (Boolean)': {
    platform: '', fields: 'Title, abstract, keywords',
    block: (ts) => `( ${or(ts)} )`,
    limits: () => [],
  },
};

export function buildQuery(db, blocks, limits = {}) {
  const sx = SYNTAX[db];
  const parts = blocks.map((b) => termsOf(b)).filter((ts) => ts.length).map(sx.block);
  return [...parts, ...sx.limits(limits).filter(Boolean)].join('\nAND ');
}

export default function SearchBuilder({ streams, readOnly = false }) {
  const { review, update } = useReview();
  const search = { blocks: [], queries: [], limits: {}, ...(review.search || {}) };
  const [open, setOpen] = useState(false);
  const [db, setDb] = useState('Scopus');
  const setSearch = (patch) => update((r) => ({ ...r, search: { blocks: [], queries: [], limits: {}, ...(r.search || {}), ...patch } }));
  const setBlock = (id, patch) => setSearch({ blocks: search.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const setQuery = (id, patch) => setSearch({ queries: search.queries.map((q) => (q.id === id ? { ...q, ...patch } : q)) });
  const letter = (i) => String.fromCharCode(65 + (i % 26));
  const word = streams ? 'stream' : 'query';

  const createRun = (q) => {
    const blocks = q.blocks.map((id) => search.blocks.find((b) => b.id === id)).filter(Boolean);
    const sx = SYNTAX[db];
    const run = {
      ...newRun(), database: db === 'Generic (Boolean)' ? '' : db, platform: sx.platform, fields: sx.fields,
      searchString: buildQuery(db, blocks, search.limits),
      dateRange: [search.limits.yearFrom, search.limits.yearTo].filter(Boolean).join('–'),
      filters: search.limits.language ? `Language: ${search.limits.language}` : '',
      stream: streams ? q.name : '', variant: streams ? q.variant || '' : '',
      notes: `Built from term blocks ${blocks.map((b) => b.label).join(' AND ')} (search builder).${sx.note ? ` ${sx.note}` : ''}`,
    };
    update((r) => ({ ...r, runs: [...r.runs, run] }));
  };

  return (
    <Card className="mb-6">
      <button className="flex w-full items-center justify-between px-5 py-3 text-left" onClick={() => setOpen(!open)}>
        <span><span className="mr-2 text-xs text-stone-400">{open ? '▾' : '▸'}</span><span className="font-medium">Search builder</span>
          <span className="ml-2 text-xs text-stone-500">{search.blocks.length} term blocks · {search.queries.length} {word}{search.queries.length === 1 ? '' : 's'}</span></span>
        <span className="text-xs text-stone-500">term blocks → database-specific search strings</span>
      </button>
      {open && (
        <ReadOnly when={readOnly}>
        <div className="space-y-6 border-t border-stone-100 p-5">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-stone-500">Term blocks (one term per line; terms in a block are combined with OR)</span>
              <Button size="sm" onClick={() => setSearch({ blocks: [...search.blocks, { id: uid('blk'), label: `Block ${letter(search.blocks.length)}`, terms: '' }] })}>+ Block</Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {search.blocks.map((b) => (
                <div key={b.id} className="space-y-1">
                  <div className="flex gap-2">
                    <Input value={b.label} onChange={(e) => setBlock(b.id, { label: e.target.value })} />
                    <Button tone="ghost" size="sm" onClick={() => setSearch({ blocks: search.blocks.filter((x) => x.id !== b.id), queries: search.queries.map((q) => ({ ...q, blocks: q.blocks.filter((x) => x !== b.id) })) })}>✕</Button>
                  </div>
                  <Textarea rows={5} className="font-mono text-xs" placeholder={'"large language model*"\n"generative AI"'} value={b.terms} onChange={(e) => setBlock(b.id, { terms: e.target.value })} />
                  <div className="text-[11px] text-stone-400">{termsOf(b).length} terms · {termsOf(b).filter((t) => t.includes('*')).length} wildcards</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Years from"><Input type="number" value={search.limits.yearFrom || ''} onChange={(e) => setSearch({ limits: { ...search.limits, yearFrom: e.target.value } })} /></Field>
            <Field label="Years to"><Input type="number" value={search.limits.yearTo || ''} onChange={(e) => setSearch({ limits: { ...search.limits, yearTo: e.target.value } })} /></Field>
            <Field label="Language"><Input value={search.limits.language || ''} placeholder="English" onChange={(e) => setSearch({ limits: { ...search.limits, language: e.target.value } })} /></Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-medium uppercase tracking-wide text-stone-500">{streams ? 'Streams (blocks combined with AND)' : 'Queries (blocks combined with AND)'}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-stone-500">Syntax</span>
                <div className="w-60"><Select value={db} onChange={(e) => setDb(e.target.value)}>{Object.keys(SYNTAX).map((k) => <option key={k} value={k}>{k}</option>)}</Select></div>
                <Button size="sm" onClick={() => setSearch({ queries: [...search.queries, { id: uid('qry'), name: streams ? `RQ${search.queries.length + 1}` : `Query ${search.queries.length + 1}`, variant: streams ? 'primary' : '', blocks: search.blocks.map((b) => b.id) }] })} disabled={!search.blocks.length}>+ {streams ? 'Stream' : 'Query'}</Button>
              </div>
            </div>
            {SYNTAX[db].note && <p className="mb-2 text-xs text-amber-800">{SYNTAX[db].note}</p>}
            <div className="space-y-3">
              {search.queries.map((q) => {
                const blocks = q.blocks.map((id) => search.blocks.find((b) => b.id === id)).filter(Boolean);
                const str = buildQuery(db, blocks, search.limits);
                return (
                  <div key={q.id} className="border border-stone-200 p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="w-40"><Input value={q.name} onChange={(e) => setQuery(q.id, { name: e.target.value })} /></div>
                      {streams && <div className="w-48"><Select value={q.variant || ''} onChange={(e) => setQuery(q.id, { variant: e.target.value })}><option value="">—</option>{STREAM_VARIANTS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}</Select></div>}
                      <div className="flex flex-wrap gap-2 text-sm">
                        {search.blocks.map((b) => (
                          <label key={b.id} className="flex items-center gap-1">
                            <input type="checkbox" checked={q.blocks.includes(b.id)} onChange={(e) => setQuery(q.id, { blocks: e.target.checked ? search.blocks.map((x) => x.id).filter((id) => id === b.id || q.blocks.includes(id)) : q.blocks.filter((x) => x !== b.id) })} />
                            {b.label}
                          </label>
                        ))}
                      </div>
                      <div className="ml-auto flex gap-1">
                        <Button size="sm" tone="ghost" onClick={() => navigator.clipboard?.writeText(str)}>Copy</Button>
                        <Button size="sm" onClick={() => createRun(q)} disabled={!blocks.length} title="Adds a documented search run with this string; run it in the database and import the export there">Create search run</Button>
                        <Button size="sm" tone="ghost" onClick={() => setSearch({ queries: search.queries.filter((x) => x.id !== q.id) })}>✕</Button>
                      </div>
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap bg-stone-50 p-2 font-mono text-[11px] text-stone-700">{str || '(choose blocks)'}</pre>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        </ReadOnly>
      )}
    </Card>
  );
}
