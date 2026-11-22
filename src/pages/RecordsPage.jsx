import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useReview } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { recomputeDuplicates } from '../lib/dedup.js';
import { reviewSettings } from '../lib/methods.js';
import { attachPdf, matchPdf } from '../lib/pdfs.js';
import { DECISION_LABEL, finalDecision } from '../lib/model.js';
import { Badge, Button, Card, Input, SectionTitle, Select } from '../components/ui.jsx';

const FILTERS = {
  all: ['All records', () => true],
  unique: ['Unique (screening pool)', (r) => !r.duplicateOf],
  dup: ['Duplicates', (r) => r.duplicateOf],
  dup_fuzzy: ['Possible duplicates (fuzzy match, please check)', (r) => r.duplicateOf && r.dupBy === 'fuzzy'],
  ta_pending: ['T/A no final decision', (r, rv) => !r.duplicateOf && !finalDecision(rv, 'ta', r.id).decision],
  ta_conflict: ['T/A conflict between reviewers', (r, rv) => !r.duplicateOf && finalDecision(rv, 'ta', r.id).status === 'conflict'],
  ta_basket: ['T/A: review with full text', (r, rv) => !r.duplicateOf && finalDecision(rv, 'ta', r.id).decision === 'unclear'],
  ft_pool: ['Full-text pool', (r, rv) => !r.duplicateOf && ['include', 'unclear'].includes(finalDecision(rv, 'ta', r.id).decision)],
  ft_nopdf: ['Full-text pool without PDF', (r, rv) => !r.duplicateOf && ['include', 'unclear'].includes(finalDecision(rv, 'ta', r.id).decision) && !r.pdf],
  included: ['Included (final)', (r, rv) => !r.duplicateOf && finalDecision(rv, 'ft', r.id).decision === 'include'],
};

export default function RecordsPage() {
  const { review, update } = useReview();
  const [filter, setFilter] = useState('unique');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(100);
  const [open, setOpen] = useState(null);
  const [bulk, setBulk] = useState(null);
  const bulkRef = useRef();

  const runName = useMemo(() => Object.fromEntries(review.runs.map((r) => [r.id, r.database || 'run'])), [review.runs]);
  const byId = useMemo(() => Object.fromEntries(review.records.map((r) => [r.id, r])), [review.records]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return review.records.filter((r) => FILTERS[filter][1](r, review)).filter((r) =>
      !needle || [r.title, r.doi, r.authors.join(' '), r.year].join(' ').toLowerCase().includes(needle));
  }, [review, filter, q]);

  const toggleDup = (rec) => update((r) => ({
    ...r,
    records: recomputeDuplicates(r.records.map((x) => (x.id === rec.id ? { ...x, notDuplicate: !!x.duplicateOf } : x)), reviewSettings(r).dedup),
  }));

  async function onBulk(e) {
    const files = [...e.target.files].filter((f) => /\.pdf$/i.test(f.name));
    e.target.value = '';
    const pool = review.records.filter((r) => !r.duplicateOf);
    const matched = [], unmatched = [];
    for (const f of files) { const m = matchPdf(f, pool); (m ? matched : unmatched).push({ file: f, ...m }); }
    setBulk({ matched, unmatched, done: 0, running: true });
    for (const [i, m] of matched.entries()) {
      try { await attachPdf(review.id, m.record.id, m.file, update); } catch (err) { console.error(err); }
      setBulk((b) => ({ ...b, done: i + 1 }));
    }
    setBulk((b) => ({ ...b, running: false }));
  }

  return (
    <div className="px-8 py-8">
      <SectionTitle
        title="Records"
        hint="All imported records. Duplicates were detected by DOI or normalised title + year and are excluded from screening; override any false positives here."
        actions={<>
          <input ref={bulkRef} type="file" multiple accept="application/pdf" className="hidden" onChange={onBulk} />
          <Button onClick={() => bulkRef.current.click()}>Attach PDFs in bulk…</Button>
        </>}
      />
      {bulk && (
        <Card className="mb-4 p-4 text-sm">
          <div className="flex items-center justify-between">
            <div>
              {bulk.running ? `Uploading ${bulk.done}/${bulk.matched.length}…` : `Attached ${bulk.done} PDFs.`}{' '}
              {bulk.unmatched.length > 0 && <span className="text-amber-700">{bulk.unmatched.length} files could not be matched. Attach them per record.</span>}
            </div>
            {!bulk.running && <Button size="sm" tone="ghost" onClick={() => setBulk(null)}>Dismiss</Button>}
          </div>
          {!bulk.running && bulk.unmatched.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-stone-500">{bulk.unmatched.map((u) => <li key={u.file.name}>{u.file.name}</li>)}</ul>
          )}
        </Card>
      )}
      <div className="mb-3 flex gap-3">
        <div className="w-64"><Select value={filter} onChange={(e) => { setFilter(e.target.value); setLimit(100); }}>
          {Object.entries(FILTERS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </Select></div>
        <div className="w-96"><Input placeholder="Search title, author, DOI, year…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="ml-auto self-center text-sm text-stone-500">{rows.length} records</div>
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs text-stone-500">
            <tr>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-2 font-medium">Year</th>
              <th className="px-2 font-medium">Source</th>
              <th className="px-2 font-medium">T/A</th>
              <th className="px-2 font-medium">Full text</th>
              <th className="px-2 font-medium">PDF</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => (
              <RecordRow key={r.id} r={r} review={review} runName={runName} byId={byId}
                open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} onToggleDup={() => toggleDup(r)} update={update} />
            ))}
          </tbody>
        </table>
        {rows.length > limit && (
          <div className="border-t border-stone-100 p-3 text-center">
            <Button size="sm" onClick={() => setLimit(limit + 200)}>Show more ({rows.length - limit} remaining)</Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function StatusBadge({ fin }) {
  if (fin.status === 'conflict') return <Badge tone="exclude">conflict</Badge>;
  if (!fin.decision) return <Badge tone="pending" />;
  return <Badge tone={fin.decision}>{DECISION_LABEL[fin.decision]}{fin.status === 'consensus' ? ' ✓' : ''}</Badge>;
}

function RecordRow({ r, review, runName, byId, open, onToggle, onToggleDup, update }) {
  const ta = finalDecision(review, 'ta', r.id);
  const ft = finalDecision(review, 'ft', r.id);
  const fileRef = useRef();
  const onFile = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await attachPdf(review.id, r.id, f, update); };
  return (
    <>
      <tr className={`cursor-pointer border-t border-stone-100 hover:bg-stone-50 ${r.duplicateOf ? 'opacity-60' : ''}`} onClick={onToggle}>
        <td className="max-w-xl px-4 py-2">
          <div className="line-clamp-1">{r.title}</div>
          <div className="line-clamp-1 text-xs text-stone-500">{r.authors.slice(0, 3).join('; ')}{r.authors.length > 3 ? ' et al.' : ''} · {r.journal}</div>
        </td>
        <td className="px-2 tabular-nums">{r.year}</td>
        <td className="px-2 text-xs">{runName[r.runId]}</td>
        <td className="px-2">{r.duplicateOf ? <Badge tone="duplicate">dup</Badge> : <StatusBadge fin={ta} />}</td>
        <td className="px-2">{ft.status !== 'pending' ? <StatusBadge fin={ft} /> : ''}</td>
        <td className="px-2">{r.pdf ? <Badge tone="info">PDF</Badge> : ''}</td>
      </tr>
      {open && (
        <tr className="bg-stone-50/60">
          <td colSpan={6} className="px-4 pb-4 pt-1 text-sm">
            {r.duplicateOf && (
              <div className="mb-2 rounded bg-violet-50 px-3 py-2 text-xs text-violet-800">
                Duplicate (by {r.dupBy}{r.dupScore ? `, ${Math.round(r.dupScore * 100)}% similar` : ''}) of: <b>{byId[r.duplicateOf]?.title}</b> [{runName[byId[r.duplicateOf]?.runId]}]
              </div>
            )}
            <p className="max-w-4xl text-stone-700">{r.abstract || <i className="text-stone-400">No abstract.</i>}</p>
            {r.keywords.length > 0 && <p className="mt-2 text-xs text-stone-500">Keywords: {r.keywords.join('; ')}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {r.doi && <a className="text-indigo-700 hover:underline" href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">doi:{r.doi}</a>}
              {r.url && <a className="text-indigo-700 hover:underline" href={r.url} target="_blank" rel="noreferrer">link</a>}
              <span className="flex-1" />
              {r.pdf && <a className="text-indigo-700 hover:underline" href={api.pdfUrl(review.id, r.id)} target="_blank" rel="noreferrer">Open PDF</a>}
              <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={onFile} />
              <Button size="sm" onClick={(e) => { e.stopPropagation(); fileRef.current.click(); }}>{r.pdf ? 'Replace PDF' : 'Attach PDF'}</Button>
              {(r.duplicateOf || r.notDuplicate) && (
                <Button size="sm" onClick={(e) => { e.stopPropagation(); onToggleDup(); }}>{r.duplicateOf ? 'Not a duplicate' : 'Re-check duplicate'}</Button>
              )}
              {!r.duplicateOf && <Link to={`../screen/ta?rec=${r.id}`}><Button size="sm">Screen T/A</Button></Link>}
              {!r.duplicateOf && ['include', 'unclear'].includes(ta.decision) && <Link to={`../screen/ft?rec=${r.id}`}><Button size="sm">Screen full text</Button></Link>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
