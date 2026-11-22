// Critical appraisal / risk of bias of the included sources (optional step, switched on in the settings).
// The tool (items + rating scale) lives in review.appraisalTool; each reviewer's judgements in
// decisions.appraisal[recordId] = { answers: {itemId: value}, support: {itemId: text}, overall, note, done }.
import { useCallback, useMemo, useState } from 'react';
import { useReview } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { appraisalPool, decisionsOf, finalAppraisal, isAssigned, isHuman, uid } from '../lib/model.js';
import { APPRAISAL_TOOLS, guide } from '../lib/methods.js';
import { cohen, fmtK, kappaBand, pct } from '../lib/agreement.js';
import { QueueBar, useQueue } from '../components/Screening.jsx';
import PdfViewer from '../components/PdfViewer.jsx';
import { Badge, Button, Card, Empty, Input, SectionTitle, Select, Stat, Textarea } from '../components/ui.jsx';

const toolFrom = (key) => {
  const t = APPRAISAL_TOOLS[key];
  return { tool: key, label: t.label, scale: t.scale, overall: t.overall, items: t.items.map((label) => ({ id: uid('ai'), label, help: '' })) };
};

export default function AppraisalPage() {
  const { review } = useReview();
  const [tab, setTab] = useState(review.appraisalTool?.items?.length ? 'appraise' : 'tool');
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-stone-200 bg-white px-6 pt-2 text-sm">
        {[['appraise', 'Appraise sources'], ['compare', 'Compare & consensus'], ['tool', 'Appraisal tool']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`border-b-2 px-3 py-2 ${tab === k ? 'border-black font-bold' : 'border-transparent text-stone-600 hover:text-black'}`}>{l}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'appraise' && <Appraise />}
        {tab === 'compare' && <div className="h-full overflow-auto"><Compare /></div>}
        {tab === 'tool' && <div className="h-full overflow-auto"><ToolEditor /></div>}
      </div>
    </div>
  );
}

// ---- tool setup -------------------------------------------------------------------------
function ToolEditor() {
  const { review, update } = useReview();
  const t = review.appraisalTool;
  const setT = (patch) => update((r) => ({ ...r, appraisalTool: { ...r.appraisalTool, ...patch } }));
  const used = review.reviewers.some((rv) => Object.keys(decisionsOf(review, rv.id).appraisal || {}).length);
  const choose = (key) => {
    if (t?.items?.length && !confirm(`Replace the current tool (${t.label}) with ${APPRAISAL_TOOLS[key].label}?${used ? ' Appraisals already made refer to the old items and will no longer be shown.' : ''}`)) return;
    update((r) => ({ ...r, appraisalTool: toolFrom(key) }));
  };
  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <SectionTitle title="Appraisal tool" hint={guide(review, 'appraisal')} />
      <Card className="space-y-3 p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-stone-500">Start from a tool</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(APPRAISAL_TOOLS).map(([k, x]) => (
            <Button key={k} tone={t?.tool === k ? 'primary' : 'secondary'} onClick={() => choose(k)}>{x.label}</Button>
          ))}
        </div>
        <p className="text-xs text-stone-500">Item wording follows the published tools in short form; consult the official guidance documents for the signalling questions. All items can be edited.</p>
      </Card>
      {t && (
        <div className="mt-6 space-y-2">
          <div className="text-sm"><b>{t.label}</b> · item scale: {t.scale.map((s) => s.label).join(' / ')} · overall: {t.overall.map((s) => s.label).join(' / ')}</div>
          {t.items.map((it, i) => (
            <Card key={it.id} className="flex items-start gap-3 p-3">
              <span className="mt-1.5 w-8 text-sm text-stone-400">{i + 1}.</span>
              <div className="flex-1 space-y-1.5">
                <Input value={it.label} onChange={(e) => setT({ items: t.items.map((x) => (x.id === it.id ? { ...x, label: e.target.value } : x)) })} />
                <Input placeholder="Guidance for appraisers (optional)" value={it.help || ''} onChange={(e) => setT({ items: t.items.map((x) => (x.id === it.id ? { ...x, help: e.target.value } : x)) })} />
              </div>
              <Button tone="ghost" size="sm" onClick={() => setT({ items: t.items.filter((x) => x.id !== it.id) })}>✕</Button>
            </Card>
          ))}
          <Button size="sm" onClick={() => setT({ items: [...t.items, { id: uid('ai'), label: '', help: '' }] })}>+ Item</Button>
        </div>
      )}
    </div>
  );
}

// ---- appraising --------------------------------------------------------------------------
function ScaleButtons({ scale, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1">
      {scale.map((s) => (
        <button key={s.value} type="button" onClick={() => onChange(value === s.value ? null : s.value)}
          className={`px-2 py-0.5 text-xs ring-1 ring-inset ${value === s.value ? 'bg-stone-800 text-white ring-stone-800' : 'bg-white text-stone-700 ring-stone-300 hover:bg-stone-100'}`}>{s.label}</button>
      ))}
    </div>
  );
}

function Appraise() {
  const { review, updateMine, me, reviewer } = useReview();
  const t = review.appraisalTool;
  const pool = useMemo(() => appraisalPool(review).filter((r) => isAssigned(reviewer, 'appraisal', r.id)), [review, reviewer]);
  const mine = decisionsOf(review, me).appraisal || {};
  const doneMap = useMemo(() => Object.fromEntries(Object.entries(mine).filter(([, a]) => a.done)), [mine]);
  const q = useQueue(pool, doneMap);
  const r = q.current;
  const cur = (r && mine[r.id]) || { answers: {}, support: {}, overall: null, note: '', done: false };
  const set = (patch) => updateMine((d) => ({ ...d, appraisal: { ...(d.appraisal || {}), [r.id]: { ...((d.appraisal || {})[r.id] || { answers: {}, support: {}, note: '' }), ...patch } } }));

  const finish = useCallback(async () => {
    if (!r) return;
    let next;
    await updateMine((d) => {
      const prev = (d.appraisal || {})[r.id] || { answers: {}, support: {}, note: '' };
      const { history: h = [], ...prevNoHist } = prev;
      next = { ...(d.appraisal || {}), [r.id]: { ...prev, done: true, appraiser: reviewer.name, appraisedAt: new Date().toISOString(), history: prev.done ? [...h, prevNoHist] : h } };
      return { ...d, appraisal: next };
    });
    q.next(Object.fromEntries(Object.entries(next).filter(([, a]) => a.done)));
  }, [r, updateMine, reviewer, q]);

  if (!t?.items?.length) return <div className="p-8"><Empty title="No appraisal tool chosen yet">Choose a tool under the “Appraisal tool” tab.</Empty></div>;
  const bar = <QueueBar q={q} stage="appraisal" reviewer={reviewer}><span className="text-xs text-stone-500">{t.label}</span></QueueBar>;
  if (!pool.length) {
    return <div className="flex h-full flex-col">{bar}<div className="p-8"><Empty title="Nothing to appraise">Sources with a final full-text decision of include appear here{reviewer.assignment?.appraisal?.mode === 'none' ? ', but you are not participating in appraisal (see Reviewers)' : ''}.</Empty></div></div>;
  }
  const complete = t.items.every((it) => cur.answers?.[it.id]) && cur.overall;

  return (
    <div className="flex h-full flex-col">
      {bar}
      {!r ? (
        <div className="p-8"><Empty title="All sources in this view are appraised">Switch the filter to revisit them.</Empty></div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            {r.pdf ? (
              <PdfViewer url={api.pdfUrl(review.id, r.id, r.pdf.uploadedAt)} highlights={[]} onAddHighlight={() => {}} criteria={[]} kindOf={() => 'general'} />
            ) : (
              <div className="h-full overflow-auto p-10">
                <Card className="mx-auto max-w-2xl p-6">
                  <div className="text-lg font-medium">{r.title}</div>
                  <p className="mt-3 text-sm leading-relaxed text-stone-700">{r.abstract || <i>No abstract.</i>}</p>
                  <p className="mt-4 text-xs text-stone-500">No PDF attached. Attach it under Extraction &amp; coding or Records.</p>
                </Card>
              </div>
            )}
          </div>
          <aside className="flex w-[460px] shrink-0 flex-col border-l border-stone-200 bg-stone-50">
            <div className="border-b border-stone-200 bg-white p-4">
              <div className="text-[15px] font-medium leading-snug">{r.title}</div>
              <div className="mt-1 text-xs text-stone-500">{r.authors.slice(0, 3).join('; ')}{r.authors.length > 3 ? ' et al.' : ''} · {r.year} · {r.journal}</div>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
              {t.items.map((it, i) => (
                <div key={it.id} className="space-y-1">
                  <div className="text-sm"><span className="text-stone-400">{i + 1}.</span> {it.label}</div>
                  {it.help && <div className="text-[11px] text-stone-400">{it.help}</div>}
                  <ScaleButtons scale={t.scale} value={cur.answers?.[it.id]} onChange={(v) => set({ answers: { ...(cur.answers || {}), [it.id]: v } })} />
                  <Input className="!text-xs" placeholder="Support for judgement (quote, page)" value={cur.support?.[it.id] || ''} onChange={(e) => set({ support: { ...(cur.support || {}), [it.id]: e.target.value } })} />
                </div>
              ))}
              <div className="space-y-1 border-t border-stone-200 pt-3">
                <div className="text-sm font-medium">Overall judgement</div>
                <ScaleButtons scale={t.overall} value={cur.overall} onChange={(v) => set({ overall: v })} />
              </div>
              <Textarea rows={3} placeholder="Notes" value={cur.note || ''} onChange={(e) => set({ note: e.target.value })} />
            </div>
            <div className="border-t border-stone-200 bg-white p-4">
              <Button tone="primary" size="lg" className="w-full" onClick={finish} disabled={!complete}>{cur.done ? 'Save & next' : 'Mark appraised & next'}</Button>
              {!complete && <div className="mt-2 text-xs text-stone-400">Rate every item and give an overall judgement.</div>}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

// ---- compare & consensus -------------------------------------------------------------------
function Compare() {
  const { review, update } = useReview();
  const t = review.appraisalTool;
  const humans = review.reviewers.filter(isHuman);
  const pool = appraisalPool(review);
  const label = (scale, v) => scale?.find((s) => s.value === v)?.label || v || '–';
  const [open, setOpen] = useState(null);

  // Pairwise agreement on the overall judgement between the first two human appraisers with shared records.
  const stats = useMemo(() => {
    const out = [];
    for (let i = 0; i < review.reviewers.length; i++) for (let j = i + 1; j < review.reviewers.length; j++) {
      const A = decisionsOf(review, review.reviewers[i].id).appraisal || {};
      const B = decisionsOf(review, review.reviewers[j].id).appraisal || {};
      const shared = Object.keys(A).filter((id) => A[id]?.done && B[id]?.done);
      if (shared.length) out.push({ a: review.reviewers[i], b: review.reviewers[j], ...cohen(shared.map((id) => [A[id].overall, B[id].overall])) });
    }
    return out;
  }, [review]);

  if (!t) return <div className="p-8"><Empty title="No appraisal tool chosen yet" /></div>;
  const rows = pool.map((r) => ({ r, fin: finalAppraisal(review, r.id), votes: review.reviewers.map((rv) => ({ rv, a: decisionsOf(review, rv.id).appraisal?.[r.id] })).filter((x) => x.a?.done) }))
    .filter((x) => x.votes.length);
  const setConsensus = (rid, patch) => update((rv) => {
    const { status: _s, ...base } = rv.consensus?.appraisal?.[rid] || finalAppraisal(rv, rid);
    return { ...rv, consensus: { ...rv.consensus, appraisal: { ...(rv.consensus?.appraisal || {}), [rid]: { answers: {}, ...base, ...patch, decidedAt: new Date().toISOString() } } } };
  });
  const clearConsensus = (rid) => update((rv) => { const { [rid]: _x, ...rest } = rv.consensus?.appraisal || {}; return { ...rv, consensus: { ...rv.consensus, appraisal: rest } }; });

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-8 py-8">
      <SectionTitle title="Compare & consensus" hint={`Overall judgements of independent appraisers. Final = consensus, else agreement of the human appraisers (${humans.map((h) => h.name).join(', ') || 'none yet'}).`} />
      {stats.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {stats.map((s) => <Stat key={`${s.a.id}${s.b.id}`} label={`${s.a.name} × ${s.b.name} (n = ${s.n})`} value={pct(s.agree)} sub={`κ ${fmtK(s.kappa)} ${kappaBand(s.kappa)}`} />)}
        </div>
      )}
      {!rows.length && <Empty title="No appraisals yet" />}
      <Card className="divide-y divide-stone-100">
        {rows.map(({ r, fin, votes }) => (
          <div key={r.id} className="px-5 py-3">
            <button className="flex w-full items-start gap-3 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
              <span className="flex-1 text-sm font-medium">{r.title}</span>
              {votes.map(({ rv, a }) => <span key={rv.id} className="text-xs text-stone-500">{rv.name}: <b>{label(t.overall, a.overall)}</b></span>)}
              <Badge tone={fin.status === 'conflict' ? 'exclude' : fin.status === 'consensus' ? 'info' : 'pending'}>{fin.status === 'conflict' ? 'conflict' : `final: ${label(t.overall, fin.overall)}`}</Badge>
            </button>
            {open === r.id && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-stone-500"><th className="py-1 pr-3 font-medium">Item</th>{votes.map(({ rv }) => <th key={rv.id} className="pr-3 font-medium">{rv.name}</th>)}<th className="font-medium">Consensus</th></tr></thead>
                  <tbody>
                    {t.items.map((it) => {
                      const vals = votes.map(({ a }) => a.answers?.[it.id]);
                      const differ = new Set(vals).size > 1;
                      return (
                        <tr key={it.id} className={`border-t border-stone-100 ${differ ? 'bg-rose-50/60' : ''}`}>
                          <td className="py-1 pr-3">{it.label}</td>
                          {votes.map(({ rv, a }) => <td key={rv.id} className="pr-3" title={a.support?.[it.id] || ''}>{label(t.scale, a.answers?.[it.id])}</td>)}
                          <td><Select className="!py-0.5 !text-xs" value={review.consensus?.appraisal?.[r.id]?.answers?.[it.id] || ''} onChange={(e) => setConsensus(r.id, { answers: { ...(review.consensus?.appraisal?.[r.id]?.answers || fin.answers || {}), [it.id]: e.target.value } })}>
                            <option value="">–</option>{t.scale.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </Select></td>
                        </tr>
                      );
                    })}
                    <tr className="border-t border-stone-200 font-medium">
                      <td className="py-1 pr-3">Overall</td>
                      {votes.map(({ rv, a }) => <td key={rv.id} className="pr-3">{label(t.overall, a.overall)}</td>)}
                      <td><Select className="!py-0.5 !text-xs" value={review.consensus?.appraisal?.[r.id]?.overall || ''} onChange={(e) => setConsensus(r.id, { overall: e.target.value || null })}>
                        <option value="">–</option>{t.overall.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </Select></td>
                    </tr>
                  </tbody>
                </table>
                {review.consensus?.appraisal?.[r.id] && <Button size="sm" tone="ghost" className="mt-2" onClick={() => clearConsensus(r.id)}>Remove consensus</Button>}
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
