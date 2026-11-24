import { useRef, useState } from 'react';
import { useReview } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { DATABASES, newRun, STREAM_VARIANTS, uid } from '../lib/model.js';
import { detectFormat, FORMATS } from '../lib/parsers.js';
import { buildIndex, findDuplicate, addToIndex, recomputeDuplicates } from '../lib/dedup.js';
import { guide, reviewSettings } from '../lib/methods.js';
import { Badge, Button, Card, Empty, Field, Input, SectionTitle, Select, Textarea } from '../components/ui.jsx';
import SearchBuilder from '../components/SearchBuilder.jsx';
import { PlanBanner, ReadOnly, usePlanAccess } from '../components/PlanLock.jsx';

export default function SearchesPage() {
  const { review, update } = useReview();
  const add = () => update((r) => ({ ...r, runs: [...r.runs, newRun()] }));
  const streams = reviewSettings(review).streams;
  const { editable } = usePlanAccess();
  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <PlanBanner what="searches and imports" />
      <SectionTitle
        title="Search runs"
        hint={`Document one run per database/source exactly as executed (${guide(review, 'searchItem')}): platform, full search string, fields, limits and date. Then import the export file. Raw export files are archived unchanged.`}
        actions={editable && <Button tone="primary" onClick={add}>+ New search run</Button>}
      />
      <SearchBuilder streams={streams} readOnly={!editable} />
      {review.runs.length === 0 && <Empty title="No search runs yet">Create one run per database you searched.</Empty>}
      <div className="space-y-6">
        {review.runs.map((run, i) => <RunCard key={run.id} run={run} n={i + 1} editable={editable} />)}
      </div>
    </div>
  );
}

function RunCard({ run, n, editable }) {
  const { review, update } = useReview();
  const { manage } = usePlanAccess();
  const streams = reviewSettings(review).streams;
  const [open, setOpen] = useState(!run.database && editable);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const set = (patch) => update((r) => ({ ...r, runs: r.runs.map((x) => (x.id === run.id ? { ...x, ...patch } : x)) }));
  const recs = review.records.filter((r) => r.runId === run.id);
  const dups = recs.filter((r) => r.duplicateOf).length;

  async function onFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    const format = detectFormat(file.name, text);
    const entries = FORMATS[format].parse(text);
    // dry-run dedup for the preview
    const index = buildIndex(review.records, reviewSettings(review).dedup);
    let dupCount = 0;
    for (const en of entries) {
      if (findDuplicate(index, en)) dupCount++;
      else addToIndex(index, { ...en, id: 'tmp' });
    }
    setPreview({ file, format, entries, dupCount });
  }

  async function confirmImport() {
    setBusy(true);
    try {
      const { storedAs } = await api.uploadImport(review.id, preview.file);
      const importId = uid('imp');
      const now = new Date().toISOString();
      await update((r) => {
        const index = buildIndex(r.records, reviewSettings(r).dedup);
        let dupCount = 0;
        const newRecs = preview.entries.map((en) => {
          const rec = { id: uid('rec'), runId: run.id, importId, ...en, pdf: null, importedAt: now, duplicateOf: null, dupBy: null };
          const hit = findDuplicate(index, rec);
          if (hit) { dupCount++; rec.duplicateOf = hit.match.id; rec.dupBy = hit.by; rec.dupScore = hit.score ?? null; } else addToIndex(index, rec);
          return rec;
        });
        const imp = { id: importId, fileName: preview.file.name, storedAs, format: preview.format, count: newRecs.length, duplicates: dupCount, importedAt: now };
        return {
          ...r,
          records: [...r.records, ...newRecs],
          runs: r.runs.map((x) => (x.id === run.id ? { ...x, imports: [...x.imports, imp] } : x)),
        };
      }, { immediate: true });
      setPreview(null);
    } finally { setBusy(false); }
  }

  function removeImport(imp) {
    const ids = new Set(review.records.filter((r) => r.importId === imp.id).map((r) => r.id));
    const decided = (id) => Object.values(review.decisions || {}).some((d) => d.screening?.ta?.[id] || d.screening?.ft?.[id] || d.calibration?.ta?.[id]);
    const screened = [...ids].filter(decided).length;
    if (!confirm(`Remove ${ids.size} records from "${imp.fileName}"?${screened ? ` ${screened} of them already have screening decisions, which will be deleted for all reviewers.` : ''}`)) return;
    update((r) => {
      const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !ids.has(k)));
      return {
        ...r,
        records: recomputeDuplicates(r.records.filter((x) => !ids.has(x.id)), reviewSettings(r).dedup),
        decisions: Object.fromEntries(Object.entries(r.decisions || {}).map(([rid, d]) => [rid, {
          ...d,
          screening: { ta: strip(d.screening?.ta || {}), ft: strip(d.screening?.ft || {}) },
          calibration: { ta: strip(d.calibration?.ta || {}), ft: strip(d.calibration?.ft || {}) },
          evidence: strip(d.evidence || {}),
          coding: strip(d.coding || {}),
        }])),
        consensus: { ta: strip(r.consensus?.ta || {}), ft: strip(r.consensus?.ft || {}), coding: strip(r.consensus?.coding || {}) },
        runs: r.runs.map((x) => (x.id === run.id ? { ...x, imports: x.imports.filter((i) => i.id !== imp.id) } : x)),
      };
    }, { immediate: true });
  }

  function removeRun() {
    if (recs.length) return alert('Remove the imports of this run first.');
    if (confirm('Delete this search run?')) update((r) => ({ ...r, runs: r.runs.filter((x) => x.id !== run.id) }));
  }

  const mismatch = run.reportedHits != null && run.reportedHits !== '' && recs.length > 0 && Number(run.reportedHits) !== recs.length;

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3">
        <button className="flex items-center gap-3 text-left" onClick={() => setOpen(!open)}>
          <span className="text-xs text-stone-400">{open ? '▾' : '▸'}</span>
          <span className="text-xs font-medium tabular-nums text-stone-400">#{n}</span>
          <span className="font-medium">{run.database || 'Untitled run'}</span>
          {streams && run.stream && <span className="bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-800">{run.stream}</span>}
          {run.sourceType === 'other' && <span className="bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">other method</span>}
          {streams && run.variant && <span className="text-xs text-stone-500">{run.variant}{run.part ? ` · part ${run.part}` : ''}</span>}
          <span className="text-xs text-stone-500">{run.dateRun}</span>
        </button>
        <div className="flex items-center gap-2 text-xs text-stone-500">
          <Badge tone="info">{recs.length} imported</Badge>
          {dups > 0 && <Badge tone="duplicate">{dups} duplicates</Badge>}
          {run.reportedHits != null && run.reportedHits !== '' && <span>reported {run.reportedHits}</span>}
        </div>
      </div>

      {open && (
        <div className="grid grid-cols-2 gap-4 p-5">
          <ReadOnly when={!editable}>
          <Field label="Database / source">
            <Input list="dbs" value={run.database} onChange={(e) => set({ database: e.target.value })} placeholder="Scopus" />
            <datalist id="dbs">{DATABASES.map((d) => <option key={d} value={d} />)}</datalist>
          </Field>
          <Field label="Platform / interface" hint="e.g. Ovid, EBSCOhost, Clarivate">
            <Input value={run.platform} onChange={(e) => set({ platform: e.target.value })} />
          </Field>
          <Field label="Source type" hint="PRISMA 2020 reports other methods (websites, organisations, citation searching) separately">
            <Select value={run.sourceType || 'database'} onChange={(e) => set({ sourceType: e.target.value })}>
              <option value="database">Database or register</option>
              <option value="other">Other method (citation searching, websites, …)</option>
            </Select>
          </Field>
          <div />
          {reviewSettings(review).streams && <>
            <Field label="Search stream" hint="e.g. RQ1, or a stream defined in the search builder">
              <Input list="streams" value={run.stream || ''} onChange={(e) => set({ stream: e.target.value })} />
              <datalist id="streams">
                {[...new Set([...(review.search?.queries || []).map((q) => q.name).filter(Boolean), ...(review.protocol.questions || []).map((_, i) => `RQ${i + 1}`)])].map((v) => <option key={v} value={v} />)}
              </datalist>
            </Field>
            <Field label="Query variant">
              <Select value={run.variant || ''} onChange={(e) => set({ variant: e.target.value })}>
                <option value="">—</option>
                {STREAM_VARIANTS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
              </Select>
            </Field>
          </>}
          </ReadOnly>
          <div className="col-span-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-stone-500">Search string (exactly as executed)</span>
              <Button size="sm" tone="ghost" onClick={() => navigator.clipboard?.writeText(run.searchString)}>Copy</Button>
            </div>
            <div className="mt-1"><Textarea rows={6} value={run.searchString} readOnly={!editable} onChange={(e) => set({ searchString: e.target.value })} className={`font-mono text-xs ${editable ? '' : 'bg-stone-50'}`} /></div>
          </div>
          <ReadOnly when={!editable}>
          <Field label="Fields searched"><Input value={run.fields} onChange={(e) => set({ fields: e.target.value })} /></Field>
          <Field label="Date executed"><Input type="date" value={run.dateRun} onChange={(e) => set({ dateRun: e.target.value })} /></Field>
          <Field label="Publication date range"><Input value={run.dateRange} onChange={(e) => set({ dateRange: e.target.value })} placeholder="2010–2026" /></Field>
          <Field label="Hits reported by database" hint="To check the export is complete">
            <Input type="number" value={run.reportedHits ?? ''} onChange={(e) => set({ reportedHits: e.target.value === '' ? null : Number(e.target.value) })} />
          </Field>
          <Field label="Limits / filters" className="col-span-2">
            <Input value={run.filters} onChange={(e) => set({ filters: e.target.value })} placeholder="Language: English; Document type: article, conference paper" />
          </Field>
          </ReadOnly>
          <ReadOnly when={!manage}>
            <Field label="Notes" className="col-span-2" hint="Not part of the frozen plan."><Textarea rows={2} value={run.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
          </ReadOnly>
        </div>
      )}

      <div className="border-t border-stone-100 px-5 py-4">
        {mismatch && (
          <div className="mb-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
            Imported {recs.length} records but the database reported {run.reportedHits}. Check the export (many databases cap exports, e.g. Scopus 2,000 per CSV, WoS 1,000 per file).
          </div>
        )}
        {run.imports.length > 0 && (
          <table className="mb-3 w-full text-sm">
            <thead><tr className="text-left text-xs text-stone-500"><th className="py-1 font-medium">Export file</th><th className="font-medium">Format</th><th className="font-medium">Records</th><th className="font-medium">Duplicates</th><th className="font-medium">Imported</th><th /></tr></thead>
            <tbody>
              {run.imports.map((imp) => (
                <tr key={imp.id} className="border-t border-stone-100">
                  <td className="py-1.5"><a className="text-indigo-700 hover:underline" href={api.importUrl(review.id, imp.storedAs)}>{imp.fileName}</a></td>
                  <td>{FORMATS[imp.format]?.label}</td>
                  <td className="tabular-nums">{imp.count}</td>
                  <td className="tabular-nums">{imp.duplicates}</td>
                  <td className="text-stone-500">{new Date(imp.importedAt).toLocaleString()}</td>
                  <td className="text-right">{editable && <Button tone="ghost" size="sm" onClick={() => removeImport(imp)}>Remove</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {editable && <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".ris,.bib,.nbib,.txt,.csv,.tsv" className="hidden" onChange={onFile} />
            <Button tone="primary" size="sm" onClick={() => fileRef.current.click()}>Import results file…</Button>
            <span className="text-xs text-stone-500">RIS · BibTeX · CSV/TSV (Scopus, WoS, IEEE) · PubMed .nbib · WoS plain text</span>
          </div>
          <Button tone="ghost" size="sm" onClick={removeRun}>Delete run</Button>
        </div>}
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-6">
          <Card className="max-h-[85vh] w-full max-w-3xl overflow-auto p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Import preview: {preview.file.name}</h3>
            <p className="mt-1 text-sm text-stone-600">
              Detected <b>{FORMATS[preview.format].label}</b>. Parsed <b>{preview.entries.length}</b> records into run <b>{run.database || `#${n}`}</b>.
            </p>
            <div className="mt-4 grid grid-cols-4 gap-3 text-sm">
              {[
                ['with abstract', preview.entries.filter((e) => e.abstract).length],
                ['with keywords', preview.entries.filter((e) => e.keywords.length).length],
                ['with DOI', preview.entries.filter((e) => e.doi).length],
                ['likely duplicates', preview.dupCount],
              ].map(([l, v]) => (
                <div key={l} className="rounded-md bg-stone-50 p-3"><div className="text-xl font-semibold tabular-nums">{v}</div><div className="text-xs text-stone-500">{l}</div></div>
              ))}
            </div>
            <div className="mt-4 space-y-3">
              {preview.entries.slice(0, 3).map((e, i) => (
                <div key={i} className="rounded-md border border-stone-200 p-3 text-sm">
                  <div className="font-medium">{e.title || <i className="text-rose-600">no title</i>}</div>
                  <div className="text-xs text-stone-500">{e.authors.slice(0, 3).join('; ')} · {e.year} · {e.journal} · {e.doi}</div>
                  <div className="mt-1 line-clamp-3 text-xs text-stone-600">{e.abstract || <i>no abstract</i>}</div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button onClick={() => setPreview(null)}>Cancel</Button>
              <Button tone="primary" disabled={busy || !preview.entries.length} onClick={confirmImport}>
                {busy ? 'Importing…' : `Import ${preview.entries.length} records`}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </Card>
  );
}
