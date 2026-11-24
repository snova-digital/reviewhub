import { useCallback, useMemo, useRef, useState } from 'react';
import { useReview } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { calibrationSet, criteriaFor, criterionCode, DECISION_LABEL, decisionsOf, finalDecision, ftPool, isAssigned, uid } from '../lib/model.js';
import { attachPdf, detachPdf } from '../lib/pdfs.js';
import { buildDecision, CriteriaChecklist, DecisionPanel, QueueBar, useDecisionForm, useQueue, useScope, useScreeningKeys } from '../components/Screening.jsx';
import { EvidenceList, PasteExcerpt } from '../components/Evidence.jsx';
import PdfViewer from '../components/PdfViewer.jsx';
import { Badge, Button, Card, Empty, Kbd } from '../components/ui.jsx';

export default function ScreeningFT() {
  const { review, update, updateMine, me, reviewer } = useReview();
  const [scope, setScope] = useScope();
  const pool = useMemo(
    () => (scope === 'calibration' ? calibrationSet(review, 'ft') : ftPool(review).filter((x) => isAssigned(reviewer, 'ft', x.id))),
    [review, scope, reviewer],
  );
  const myDec = decisionsOf(review, me);
  const mine = myDec[scope].ft;
  const q = useQueue(pool, mine);
  const form = useDecisionForm(review, 'ft', q.current, mine);
  const [saving, setSaving] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [panel, setPanel] = useState('screen'); // screen | evidence | details
  const viewer = useRef();
  const fileRef = useRef();
  const r = q.current;

  // Full-text evidence of the active reviewer (coding excerpts live in the same list, tagged stage: 'coding').
  const allEvidence = myDec.evidence;
  const evidence = useMemo(() => ((r && allEvidence?.[r.id]) || []).filter((h) => h.stage !== 'coding'), [allEvidence, r]);
  const crit = useMemo(() => criteriaFor(review, 'ft').map((c) => ({ ...c, code: criterionCode(review, c.id) })), [review]);
  const kindOf = useCallback((id) => review.criteria.find((c) => c.id === id)?.kind || 'general', [review.criteria]);
  const evidenceCount = useMemo(() => evidence.reduce((m, h) => (h.criterionId ? { ...m, [h.criterionId]: (m[h.criterionId] || 0) + 1 } : m), {}), [evidence]);

  const setEvidence = (fn) => updateMine((d) => ({ ...d, evidence: { ...(d.evidence || {}), [r.id]: fn(d.evidence?.[r.id] || []) } }));
  const addHighlight = (h) => {
    setEvidence((list) => [...list, { id: uid('hl'), source: 'pdf', ...h, stage: 'ft', scope, createdAt: new Date().toISOString() }]);
    // Evidence ticks a plain criterion; a paired one stays for the reviewer to judge (the passage may support either side).
    if (h.criterionId && !form.pairedIds.includes(h.criterionId) && !form.checked.includes(h.criterionId)) form.toggle(h.criterionId);
  };
  const removeHighlight = (id) => setEvidence((list) => list.filter((h) => h.id !== id));
  const relinkHighlight = (id, criterionId) => setEvidence((list) => list.map((h) => (h.id === id ? { ...h, criterionId: criterionId || null } : h)));

  const save = useCallback(async () => {
    if (!r || !form.decision || saving) return;
    if (form.decision === 'exclude' && !form.reason) return;
    setSaving(true);
    const d = buildDecision(form, { evidenceIds: evidence.map((h) => h.id) }, reviewer.name);
    let nextFt;
    await updateMine((dec) => {
      nextFt = { ...dec[scope].ft, [r.id]: d };
      return { ...dec, [scope]: { ...dec[scope], ft: nextFt } };
    });
    setSaving(false);
    q.next(nextFt);
  }, [r, form, saving, evidence, updateMine, q, reviewer, scope]);

  useScreeningKeys({ form, stage: 'ft', onSave: save, q });

  const bar = (
    <QueueBar q={q} stage="ft" scope={scope} setScope={setScope} reviewer={reviewer} calibrationSize={review.settings.calibrationSize || 20}>
      <span className="text-xs text-stone-500">{pool.filter((x) => x.pdf).length}/{pool.length} PDFs attached</span>
    </QueueBar>
  );
  if (!pool.length) {
    return (
      <div className="flex h-full flex-col">{bar}<div className="p-8">
        {reviewer.assignment?.ft?.mode === 'none'
          ? <Empty title="You are not participating in full-text screening">Change your assignment under Reviewers.</Empty>
          : <Empty title="No records for full-text screening yet">Records with a final decision of include or “review with full text” at title/abstract appear here.</Empty>}
      </div></div>
    );
  }

  const ta = r ? finalDecision(review, 'ta', r.id) : null;
  const onFile = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await attachPdf(review.id, r.id, f, update); };

  return (
    <div className="flex h-full flex-col">
      {bar}
      {!r ? (
        <div className="p-8"><Empty title="All records in this view are assessed 🎉">Switch the filter to revisit decisions.</Empty></div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            {r.pdf ? (
              <PdfViewer
                ref={viewer}
                url={api.pdfUrl(review.id, r.id, r.pdf.uploadedAt)}
                highlights={evidence}
                activeId={activeId}
                onAddHighlight={addHighlight}
                criteria={crit}
                kindOf={kindOf}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-10">
                <Card className="max-w-lg p-8 text-center">
                  <div className="text-lg font-medium">No full text attached</div>
                  <p className="mt-2 text-sm text-stone-600">Retrieve the PDF and attach it here. If it cannot be obtained (after e.g. library, interlibrary loan, contacting authors), record it as <b>Not retrievable</b>.</p>
                  <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={onFile} />
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <Button tone="primary" onClick={() => fileRef.current.click()}>Attach PDF…</Button>
                    {r.doi && <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer"><Button>Open DOI ↗</Button></a>}
                    <a href={`https://scholar.google.com/scholar?q=${encodeURIComponent(r.title)}`} target="_blank" rel="noreferrer"><Button>Google Scholar ↗</Button></a>
                  </div>
                </Card>
              </div>
            )}
          </div>

          <aside className="flex w-[430px] shrink-0 flex-col border-l border-stone-200 bg-stone-50">
            <div className="border-b border-stone-200 bg-white p-4">
              <div className="text-[15px] font-medium leading-snug">{r.title}</div>
              <div className="mt-1 text-xs text-stone-500">{r.authors.slice(0, 3).join('; ')}{r.authors.length > 3 ? ' et al.' : ''} · {r.year} · {r.journal}</div>
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-stone-500">T/A final:</span><Badge tone={ta?.decision || 'pending'}>{DECISION_LABEL[ta?.decision] || ta?.status}</Badge>
                <span className="text-stone-400">({ta?.status})</span>
              </div>
              <div className="mt-3 flex gap-1 text-xs">
                {[['screen', 'Checklist'], ['evidence', `Evidence (${evidence.length})`], ['details', 'Abstract & PDF']].map(([k, l]) => (
                  <button key={k} onClick={() => setPanel(k)} className={`rounded px-2.5 py-1 ${panel === k ? 'bg-indigo-50 font-medium text-indigo-800' : 'text-stone-600 hover:bg-stone-100'}`}>{l}</button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-auto p-4">
              {panel === 'screen' && <CriteriaChecklist review={review} stage="ft" form={form} evidenceCount={evidenceCount} />}

              {panel === 'evidence' && (
                <div className="space-y-3">
                  <PasteExcerpt options={crit} onAdd={addHighlight} />
                  <EvidenceList
                    items={evidence}
                    options={crit}
                    kindOf={kindOf}
                    activeId={activeId}
                    onActivate={(h) => { setActiveId(h.id); if (h.rects?.length) viewer.current?.scrollTo(h); }}
                    onRelink={relinkHighlight}
                    onRemove={removeHighlight}
                    empty="Select text in the PDF, or paste an excerpt, to record the passage your decision is based on, linked to a criterion."
                  />
                </div>
              )}

              {panel === 'details' && (
                <div className="space-y-3 text-sm">
                  <p className="leading-relaxed text-stone-700">{r.abstract || <i>No abstract.</i>}</p>
                  {r.keywords.length > 0 && <p className="text-xs text-stone-500">Keywords: {r.keywords.join('; ')}</p>}
                  {r.doi && <a className="block text-xs text-indigo-700 hover:underline" href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">doi:{r.doi}</a>}
                  {r.pdf && (
                    <div className="flex items-center gap-2 text-xs text-stone-500">
                      PDF: {r.pdf.originalName}
                      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={onFile} />
                      <Button size="sm" onClick={() => fileRef.current.click()}>Replace</Button>
                      <Button size="sm" tone="danger" onClick={() => confirm('Remove PDF? Evidence highlights are kept.') && detachPdf(review.id, r.id, update)}>Remove</Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-stone-200 bg-white p-4">
              <DecisionPanel review={review} stage="ft" form={form} onSave={save} saving={saving} requireReason />
              <div className="mt-2 text-[11px] text-stone-400">
                <Kbd>1</Kbd>–<Kbd>9</Kbd> criteria · <Kbd>I</Kbd>/<Kbd>E</Kbd>/<Kbd>N</Kbd> decide · <Kbd>⏎</Kbd> save &amp; next
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
