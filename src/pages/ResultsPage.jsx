// Results & analysis: analyse the findings inside ReviewHub. Descriptive charts, an evidence map (any two
// dimensions cross-tabulated), VOSviewer-style co-occurrence networks, and a source table. Clicking any mark
// lists the sources behind it. VOSviewer files can be exported as an option.
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Papa from 'papaparse';
import { useReview } from '../lib/store.jsx';
import { buildNetwork, crosstab, DATASETS, datasetRecords, dimensions, NETWORKS, tally, vosviewerFiles } from '../lib/analysis.js';
import { fieldText, finalCoding, finalField, settledCodes } from '../lib/model.js';
import { BarList, ColumnChart, Heatmap, OTHER, SERIES } from '../components/charts.jsx';
import NetworkView from '../components/NetworkView.jsx';
import { Button, Card, Empty, Input, SectionTitle, Select, Stat } from '../components/ui.jsx';

function download(name, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
const TABS = [['overview', 'Overview'], ['map', 'Evidence map'], ['network', 'Network'], ['sources', 'Sources']];

export default function ResultsPage() {
  const { review } = useReview();
  const [tab, setTab] = useState('overview');
  const [dataset, setDataset] = useState(() => (datasetRecords(review, 'included').length ? 'included' : 'all'));
  const [selection, setSelection] = useState(null);
  const records = useMemo(() => datasetRecords(review, dataset), [review, dataset]);
  const coded = dataset === 'included';
  const dims = useMemo(() => dimensions(review).filter((d) => coded || !d.needsCoding), [review, coded]);
  const select = (sel) => setSelection(sel ? { ...sel, ids: [...new Set(sel.ids)] } : null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-stone-200 bg-white px-6 pt-2">
        <div className="flex gap-1 text-sm">
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`border-b-2 px-3 py-2 ${tab === k ? 'border-black font-bold' : 'border-transparent text-stone-600 hover:text-black'}`}>{l}</button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 pb-1.5 text-sm">
          <span className="text-stone-500">Dataset</span>
          <Select className="!w-56" value={dataset} onChange={(e) => { setDataset(e.target.value); setSelection(null); }} title={DATASETS.find((d) => d.value === dataset)?.hint}>
            {DATASETS.map((d) => <option key={d.value} value={d.value}>{d.label} ({datasetRecords(review, d.value).length})</option>)}
          </Select>
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl space-y-8 px-8 py-8">
          {!records.length ? (
            <Empty title="No records in this dataset yet">
              {dataset === 'included' ? 'Sources appear here once they have a final full-text decision of include. Switch to “All unique records” for keyword and author maps of the search results.' : 'Import search results first.'}
            </Empty>
          ) : (
            <>
              {tab === 'overview' && <Overview review={review} records={records} dims={dims} coded={coded} onSelect={select} />}
              {tab === 'map' && <EvidenceMap review={review} records={records} dims={dims} onSelect={select} />}
              {tab === 'network' && <Network review={review} records={records} coded={coded} onSelect={select} />}
              {tab === 'sources' && <SourceTable review={review} records={selection ? records.filter((r) => selection.ids.includes(r.id)) : records} coded={coded} />}
              {tab !== 'sources' && <Selection review={review} selection={selection} onClear={() => setSelection(null)} coded={coded} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- overview --------------------------------------------------------------------------------
function Overview({ review, records, dims, coded, onSelect }) {
  const byKey = Object.fromEntries(dims.map((d) => [d.key, d]));
  const years = tally(records, byKey.year).filter((y) => y.label !== 'n/a');
  const codeGroups = dims.filter((d) => d.key.startsWith('group:'));
  const fieldDims = dims.filter((d) => d.key.startsWith('field:'));
  const codedCount = coded ? records.filter((r) => settledCodes(review, r.id).length).length : 0;
  const codingConflicts = coded ? records.filter((r) => finalCoding(review, r.id).status === 'conflict').length : 0;
  const span = years.length ? `${years[0].label}–${years.at(-1).label}` : '–';
  return (
    <>
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat label={coded ? 'included sources' : 'records'} value={records.length} />
        <Stat label="publication years" value={span} />
        {coded ? <Stat label="sources with final codes" value={codedCount} sub={`${review.codebook.length} codes in the codebook${codingConflicts ? ` · ${codingConflicts} coding conflict${codingConflicts === 1 ? '' : 's'} not counted` : ''}`} /> : <Stat label="distinct keywords" value={tally(records, { ...byKey.keyword, top: null }).length} />}
        <Stat label="databases" value={tally(records, byKey.source).length} />
      </div>
      <Card className="p-5">
        <ChartTitle title="Sources per publication year" note="Click a bar to list its sources." />
        <ColumnChart data={years} onSelect={(d) => onSelect({ label: `Year ${d.label}`, ids: d.ids })} />
      </Card>
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5"><ChartTitle title="Database" /><BarList data={tally(records, byKey.source)} total={records.length} onSelect={(d) => onSelect({ label: d.label, ids: d.ids })} /></Card>
        <Card className="p-5"><ChartTitle title="Top keywords" /><BarList data={tally(records, byKey.keyword)} total={records.length} max={12} onSelect={(d) => onSelect({ label: `Keyword: ${d.label}`, ids: d.ids })} /></Card>
        {codeGroups.map((d) => (
          <Card key={d.key} className="p-5"><ChartTitle title={d.label} note="Final codes (consensus or agreement)" /><BarList data={tally(records, d)} total={records.length} onSelect={(x) => onSelect({ label: x.label, ids: x.ids })} /></Card>
        ))}
        {fieldDims.map((d) => (
          <Card key={d.key} className="p-5"><ChartTitle title={d.label} /><BarList data={tally(records, d)} total={records.length} onSelect={(x) => onSelect({ label: `${d.label.replace('Field: ', '')}: ${x.label}`, ids: x.ids })} /></Card>
        ))}
        {byKey.appraisal && <Card className="p-5"><ChartTitle title={byKey.appraisal.label} /><BarList data={tally(records, byKey.appraisal)} total={records.length} onSelect={(x) => onSelect({ label: `Appraisal: ${x.label}`, ids: x.ids })} /></Card>}
      </div>
      {coded && !codeGroups.length && !fieldDims.length && (
        <p className="text-sm text-stone-500">Define a <Link to="../code" className="underline">codebook and charting form</Link> and code the included sources to see code and field distributions here.</p>
      )}
    </>
  );
}

const ChartTitle = ({ title, note }) => (
  <div className="mb-3 flex items-baseline justify-between gap-3"><h3 className="font-bold">{title}</h3>{note && <span className="text-xs text-stone-400">{note}</span>}</div>
);

// ---- evidence map ----------------------------------------------------------------------------
function EvidenceMap({ review, records, dims, onSelect }) {
  // Default rows: the code group with the most applications (an empty group would show nothing), else keywords.
  const defRow = useMemo(() => {
    const groups = dims.filter((d) => d.key.startsWith('group:')).map((d) => ({ d, n: records.reduce((s, r) => s + d.values(r).length, 0) })).filter((x) => x.n > 0);
    return groups.sort((a, b) => b.n - a.n)[0]?.d.key || dims.find((d) => d.key === 'keyword')?.key;
  }, [dims, records]);
  const [rowKey, setRowKey] = useState(defRow);
  const [colKey, setColKey] = useState('year');
  const rowDim = dims.find((d) => d.key === rowKey) || dims[0];
  const colDim = dims.find((d) => d.key === colKey) || dims[0];
  const table = useMemo(() => crosstab(records, rowDim, colDim), [records, rowDim, colDim]);
  const exportCsv = () => download(`${slug(review.title)}-evidence-map.csv`, Papa.unparse([
    [`${rowDim.label} \\ ${colDim.label}`, ...table.cols.map((c) => c.label), 'Total'],
    ...table.rows.map((r, i) => [r.label, ...table.cells[i].map((c) => c.length), r.ids.length]),
  ]), 'text/csv');
  return (
    <>
      <SectionTitle title="Evidence map" hint="Cross-tabulate any two dimensions. Darker cells mean more sources; empty cells show the gaps in the evidence. A source with several codes counts in each of them. Click a cell to list its sources." />
      <div className="flex flex-wrap items-end gap-4">
        <label className="w-72 text-sm"><span className="text-xs font-medium uppercase tracking-wide text-stone-500">Rows</span>
          <Select value={rowDim.key} onChange={(e) => setRowKey(e.target.value)}>{dims.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</Select></label>
        <Button size="sm" tone="ghost" onClick={() => { setRowKey(colDim.key); setColKey(rowDim.key); }} title="Swap rows and columns">⇄</Button>
        <label className="w-72 text-sm"><span className="text-xs font-medium uppercase tracking-wide text-stone-500">Columns</span>
          <Select value={colDim.key} onChange={(e) => setColKey(e.target.value)}>{dims.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</Select></label>
        <Button size="sm" className="ml-auto" onClick={exportCsv}>Download CSV</Button>
      </div>
      <Card className="p-4"><Heatmap table={table} rowLabel={rowDim.label} colLabel={colDim.label} onSelect={onSelect} /></Card>
    </>
  );
}

// ---- network -----------------------------------------------------------------------------------
function Network({ review, records, coded, onSelect }) {
  const kinds = NETWORKS.filter((n) => coded || !n.needsCoding);
  const [kind, setKind] = useState(coded && review.codebook.length ? 'codes' : 'keywords');
  const [minOcc, setMinOcc] = useState(kind === 'codes' ? 1 : 2);
  const [minLink, setMinLink] = useState(1);
  const [maxNodes, setMaxNodes] = useState(100);
  const view = useRef();
  const k = kinds.some((x) => x.value === kind) ? kind : kinds[0].value;
  const net = useMemo(() => buildNetwork(review, records, k, { minOcc, minLink, maxNodes }), [review, records, k, minOcc, minLink, maxNodes]);
  const meta = NETWORKS.find((n) => n.value === k);
  const exportVos = () => {
    const { map, network } = vosviewerFiles(net);
    download(`${slug(review.title)}-${k}-vosviewer-map.txt`, map);
    setTimeout(() => download(`${slug(review.title)}-${k}-vosviewer-network.txt`, network), 300);
  };
  return (
    <>
      <SectionTitle title="Network" hint={`${meta.hint} Node size = occurrences, line width = co-occurrence strength. Hover a node to see its neighbours, click it to list its sources; scroll to zoom, drag to pan.`} />
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <label className="w-64"><span className="text-xs font-medium uppercase tracking-wide text-stone-500">Network</span>
          <Select value={k} onChange={(e) => { setKind(e.target.value); setMinOcc(e.target.value === 'codes' || e.target.value === 'fields' ? 1 : 2); }}>{kinds.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}</Select></label>
        <label className="w-36"><span className="text-xs font-medium uppercase tracking-wide text-stone-500">Min. occurrences</span><Input type="number" min={1} value={minOcc} onChange={(e) => setMinOcc(Math.max(1, Number(e.target.value) || 1))} /></label>
        <label className="w-36"><span className="text-xs font-medium uppercase tracking-wide text-stone-500">Min. link strength</span><Input type="number" min={1} value={minLink} onChange={(e) => setMinLink(Math.max(1, Number(e.target.value) || 1))} /></label>
        <label className="w-36"><span className="text-xs font-medium uppercase tracking-wide text-stone-500">Max. items</span><Input type="number" min={5} max={400} value={maxNodes} onChange={(e) => setMaxNodes(Math.min(400, Math.max(5, Number(e.target.value) || 100)))} /></label>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => view.current?.reset()}>Reset view</Button>
          <Button size="sm" onClick={() => download(`${slug(review.title)}-${k}-network.svg`, view.current.svgMarkup(), 'image/svg+xml')} disabled={!net.nodes.length}>Download SVG</Button>
          <Button size="sm" onClick={exportVos} disabled={!net.nodes.length} title="Map + network file: VOSviewer → Create → Create a map based on network data">Export to VOSviewer</Button>
        </div>
      </div>
      <div className="text-xs text-stone-500">{net.nodes.length} items · {net.links.length} links · {net.clusters.length} clusters</div>
      <Card className="overflow-hidden"><NetworkView ref={view} net={net} onSelect={onSelect} /></Card>
      {net.clusters.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-stone-700" aria-label="Legend">
          {net.clusters.slice(0, SERIES.length).map((c) => (
            <span key={c.id} className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full" style={{ background: SERIES[c.id - 1] }} />{c.label} ({c.size})</span>
          ))}
          {net.clusters.length > SERIES.length && <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full" style={{ background: OTHER }} />Other clusters ({net.clusters.slice(SERIES.length).reduce((s, c) => s + c.size, 0)})</span>}
        </div>
      )}
      <TopItems net={net} onSelect={onSelect} />
    </>
  );
}

// Table view of the network (accessible alternative to the picture).
function TopItems({ net, onSelect }) {
  const [open, setOpen] = useState(false);
  if (!net.nodes.length) return null;
  return (
    <div>
      <button className="text-sm underline" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} items as a table</button>
      {open && (
        <Card className="mt-2 max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-stone-50 text-left text-xs text-stone-500"><tr><th className="px-4 py-2 font-medium">Item</th><th className="font-medium">Cluster</th><th className="font-medium">Occurrences</th><th className="font-medium">Links</th><th className="px-4 font-medium">Total link strength</th></tr></thead>
            <tbody>
              {net.nodes.map((n) => (
                <tr key={n.id} className="cursor-pointer border-t border-stone-100 hover:bg-stone-50" onClick={() => onSelect({ label: n.label, ids: n.ids })}>
                  <td className="px-4 py-1.5">{n.label}</td><td className="tabular-nums">{n.cluster}</td><td className="tabular-nums">{n.occurrences}</td><td className="tabular-nums">{n.links}</td><td className="px-4 tabular-nums">{n.strength}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ---- selected sources --------------------------------------------------------------------------
function Selection({ review, selection, onClear, coded }) {
  if (!selection) return <p className="text-xs text-stone-400">Click a bar, cell or node to list the sources behind it.</p>;
  const recs = review.records.filter((r) => selection.ids.includes(r.id));
  const codeName = Object.fromEntries(review.codebook.map((c) => [c.id, c.label]));
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-bold">{selection.label} <span className="font-normal text-stone-500">· {recs.length} source{recs.length === 1 ? '' : 's'}</span></h3>
        <Button size="sm" tone="ghost" onClick={onClear}>Clear</Button>
      </div>
      <Card className="divide-y divide-stone-100">
        {recs.map((r) => (
          <div key={r.id} className="px-5 py-2.5 text-sm">
            {coded ? <Link to={`../code?rec=${r.id}`} className="font-medium hover:underline">{r.title}</Link> : <span className="font-medium">{r.title}</span>}
            <div className="text-xs text-stone-500">{r.authors.slice(0, 3).join('; ')}{r.authors.length > 3 ? ' et al.' : ''} ({r.year}) {r.journal}</div>
            {coded && <div className="mt-0.5 text-xs text-stone-600">{settledCodes(review, r.id).map((id) => codeName[id]).filter(Boolean).join(' · ')}</div>}
          </div>
        ))}
      </Card>
    </section>
  );
}

// ---- source table -------------------------------------------------------------------------------
function SourceTable({ review, records, coded }) {
  const [q, setQ] = useState('');
  const fields = coded ? (review.chartingForm || []) : [];
  const codeName = Object.fromEntries(review.codebook.map((c) => [c.id, c.group ? `${c.group}: ${c.label}` : c.label]));
  const rows = useMemo(() => records.map((r) => ({
    r, codes: coded ? settledCodes(review, r.id).map((id) => codeName[id]).filter(Boolean) : [],
    fields: Object.fromEntries(fields.map((f) => [f.id, fieldText(finalField(review, r.id, f.id).value)])),
  })), [records, review]); // eslint-disable-line react-hooks/exhaustive-deps
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((x) => !needle || [x.r.title, x.r.authors.join(' '), x.r.year, x.codes.join(' '), Object.values(x.fields).join(' ')].join(' ').toLowerCase().includes(needle));
  const exportCsv = () => download(`${slug(review.title)}-sources.csv`, Papa.unparse(shown.map((x) => ({
    record_id: x.r.id, title: x.r.title, authors: x.r.authors.join('; '), year: x.r.year, journal: x.r.journal, doi: x.r.doi,
    ...(coded ? { final_codes: x.codes.join('; ') } : {}),
    ...Object.fromEntries(fields.map((f) => [f.label, x.fields[f.id]])),
  }))), 'text/csv');
  return (
    <>
      <div className="flex items-center gap-3">
        <Input className="!w-80" placeholder="Filter by title, author, code, field value…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-sm text-stone-500">{shown.length} of {rows.length}</span>
        <Button size="sm" className="ml-auto" onClick={exportCsv}>Download CSV</Button>
      </div>
      <Card className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs text-stone-500">
            <tr><th className="px-4 py-2 font-medium">Source</th><th className="font-medium">Year</th>{coded && <th className="px-2 font-medium">Final codes</th>}{fields.map((f) => <th key={f.id} className="px-2 font-medium">{f.label}</th>)}</tr>
          </thead>
          <tbody>
            {shown.slice(0, 500).map((x) => (
              <tr key={x.r.id} className="border-t border-stone-100 align-top">
                <td className="max-w-md px-4 py-2"><div className="font-medium">{x.r.title}</div><div className="text-xs text-stone-500">{x.r.authors.slice(0, 2).join('; ')}{x.r.authors.length > 2 ? ' et al.' : ''} · {x.r.journal}</div></td>
                <td className="py-2 tabular-nums">{x.r.year}</td>
                {coded && <td className="max-w-xs px-2 py-2 text-xs">{x.codes.join(' · ')}</td>}
                {fields.map((f) => <td key={f.id} className="max-w-xs px-2 py-2 text-xs">{x.fields[f.id]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length > 500 && <div className="px-4 py-2 text-xs text-stone-500">Showing the first 500; download the CSV for all.</div>}
      </Card>
    </>
  );
}
