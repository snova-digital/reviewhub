// Round 3: full-text extraction and coding of the included sources.
// Each reviewer applies codes from a shared codebook and links verbatim excerpts to them.
import { useCallback, useMemo, useRef, useState } from 'react';
import { useReview } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { codebookLogEntry, codesFromQuestions, codingPool, decisionsOf, finalCoding, groupCodes, isAssigned, newCode, uid } from '../lib/model.js';
import { guide } from '../lib/methods.js';
import ChartingForm, { ChartingFields } from '../components/ChartingForm.jsx';
import { attachPdf } from '../lib/pdfs.js';
import { QueueBar, useQueue } from '../components/Screening.jsx';
import { EvidenceList, PasteExcerpt } from '../components/Evidence.jsx';
import PdfViewer from '../components/PdfViewer.jsx';
import { Button, Card, Empty, Input, SectionTitle, Select, Textarea } from '../components/ui.jsx';

export default function CodingPage() {
  const { review } = useReview();
  // Nothing to code with yet: open the setup (charting form, else codebook) instead of an empty coding view.
  const [tab, setTab] = useState(() => (review.codebook.length || (review.chartingForm || []).length ? 'code' : 'form'));
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-stone-200 bg-white px-6 pt-2 text-sm">
        {[['code', 'Code papers'], ['form', 'Charting form'], ['codebook', 'Codebook']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`border-b-2 px-3 py-2 ${tab === k ? 'border-black font-bold' : 'border-transparent text-stone-600 hover:text-black'}`}>{l}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1">{tab === 'code' ? <CodePapers /> : <div className="h-full overflow-auto">{tab === 'form' ? <ChartingForm /> : <Codebook />}</div>}</div>
    </div>
  );
}

function CodePapers() {
  const { review, update, updateMine, me, reviewer } = useReview();
  const pool = useMemo(() => codingPool(review).filter((r) => isAssigned(reviewer, 'coding', r.id)), [review, reviewer]);
  const myDec = decisionsOf(review, me);
  const coding = myDec.coding || {};
  const doneMap = useMemo(() => Object.fromEntries(Object.entries(coding).filter(([, c]) => c.done)), [coding]);
  const q = useQueue(pool, doneMap);
  const r = q.current;
  const viewer = useRef();
  const fileRef = useRef();
  const [activeId, setActiveId] = useState(null);
  const [newLabel, setNewLabel] = useState('');
  const [newGroup, setNewGroup] = useState('');

  const cur = (r && coding[r.id]) || { codes: [], note: '', done: false };
  const excerpts = useMemo(() => ((r && myDec.evidence?.[r.id]) || []).filter((h) => h.stage === 'coding'), [myDec.evidence, r]);
  const options = useMemo(() => review.codebook.map((c) => ({ id: c.id, code: c.label, text: c.group ? `${c.group}: ${c.label}` : c.label })), [review.codebook]);

  const setCoding = (patch) => updateMine((d) => ({ ...d, coding: { ...d.coding, [r.id]: { ...(d.coding?.[r.id] || { codes: [], note: '', done: false }), ...patch } } }));
  const toggleCode = (id) => setCoding({ codes: cur.codes.includes(id) ? cur.codes.filter((x) => x !== id) : [...cur.codes, id] });
  const setExcerpts = (fn) => updateMine((d) => ({ ...d, evidence: { ...(d.evidence || {}), [r.id]: fn(d.evidence?.[r.id] || []) } }));
  const addExcerpt = (h) => {
    const codeIds = h.codeIds || (h.criterionId ? [h.criterionId] : []);
    const { criterionId: _c, ...rest } = h;
    setExcerpts((list) => [...list, { id: uid('hl'), source: 'pdf', ...rest, codeIds, stage: 'coding', createdAt: new Date().toISOString() }]);
    const missing = codeIds.filter((id) => !cur.codes.includes(id));
    if (missing.length) setCoding({ codes: [...cur.codes, ...missing] });
  };
  const relink = (id, codeIds) => setExcerpts((list) => list.map((h) => (h.id === id ? { ...h, codeIds } : h)));
  const removeExcerpt = (id) => setExcerpts((list) => list.filter((h) => h.id !== id));

  // Codes created while coding are emergent (inductive) codes; logged in the codebook change log.
  const addCode = () => {
    if (!newLabel.trim()) return;
    const c = newCode({ label: newLabel.trim(), group: newGroup.trim(), origin: 'emergent' });
    update((rv) => ({ ...rv, codebook: [...rv.codebook, c], codebookLog: [...(rv.codebookLog || []), codebookLogEntry('added', c, reviewer.name, `emergent, while coding ${r?.id || ''}`)] }));
    setNewLabel('');
    if (r) toggleCode(c.id);
  };

  const finish = useCallback(async () => {
    if (!r) return;
    let next;
    await updateMine((d) => {
      const prev = d.coding?.[r.id] || { codes: [], note: '' };
      const { history: h = [], ...prevNoHist } = prev;
      next = { ...d.coding, [r.id]: { ...prev, done: true, coder: reviewer.name, codedAt: new Date().toISOString(), history: prev.done ? [...h, prevNoHist] : h } };
      return { ...d, coding: next };
    });
    q.next(Object.fromEntries(Object.entries(next).filter(([, c]) => c.done)));
  }, [r, updateMine, reviewer, q]);

  const bar = <QueueBar q={q} stage="coding" reviewer={reviewer}><span className="text-xs text-stone-500">{review.codebook.length} codes in codebook</span></QueueBar>;
  if (!pool.length) {
    return (
      <div className="flex h-full flex-col">{bar}<div className="p-8">
        {reviewer.assignment?.coding?.mode === 'none'
          ? <Empty title="You are not participating in coding">Change your assignment under Reviewers.</Empty>
          : <Empty title="No included sources yet">Records with a final full-text decision of include appear here for extraction and coding.</Empty>}
      </div></div>
    );
  }
  const onFile = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await attachPdf(review.id, r.id, f, update); };

  return (
    <div className="flex h-full flex-col">
      {bar}
      {!r ? (
        <div className="p-8"><Empty title="All sources in this view are coded 🎉">Switch the filter to revisit them.</Empty></div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            {r.pdf ? (
              <PdfViewer ref={viewer} url={api.pdfUrl(review.id, r.id, r.pdf.uploadedAt)} highlights={excerpts.map((h) => ({ ...h, criterionId: null }))}
                activeId={activeId} onAddHighlight={addExcerpt} criteria={options} kindOf={() => 'general'} generalLabel="No code yet" />
            ) : (
              <div className="h-full overflow-auto p-10">
                <Card className="mx-auto max-w-2xl p-6">
                  <div className="text-lg font-medium">{r.title}</div>
                  <p className="mt-3 text-sm leading-relaxed text-stone-700">{r.abstract || <i>No abstract.</i>}</p>
                  <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={onFile} />
                  <div className="mt-4 flex gap-2"><Button tone="primary" onClick={() => fileRef.current.click()}>Attach PDF…</Button><span className="self-center text-xs text-stone-500">or paste excerpts on the right</span></div>
                </Card>
              </div>
            )}
          </div>
          <aside className="flex w-[430px] shrink-0 flex-col border-l border-stone-200 bg-stone-50">
            <div className="border-b border-stone-200 bg-white p-4">
              <div className="text-[15px] font-medium leading-snug">{r.title}</div>
              <div className="mt-1 text-xs text-stone-500">{r.authors.slice(0, 3).join('; ')}{r.authors.length > 3 ? ' et al.' : ''} · {r.year} · {r.journal}</div>
              <StudyLink record={r} pool={pool} />
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-auto p-4">
              {(review.chartingForm || []).length > 0 && (
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">Charting form</div>
                  <ChartingFields fields={review.chartingForm} values={cur.fields || {}} onChange={(fid, v) => setCoding({ fields: { ...(cur.fields || {}), [fid]: v } })} />
                </div>
              )}
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">Codes: tick all that apply</div>
                {!review.codebook.length && <div className="mb-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">The codebook is empty. Add codes below or under the Codebook tab.</div>}
                <div className="space-y-3">
                  {groupCodes(review.codebook).map(([g, codes]) => (
                    <div key={g}>
                      <div className="mb-1 text-xs font-medium text-stone-500">{g}</div>
                      <div className="space-y-1">
                        {codes.map((c) => {
                          const on = cur.codes.includes(c.id);
                          const n = excerpts.filter((h) => h.codeIds?.includes(c.id)).length;
                          return (
                            <button key={c.id} type="button" onClick={() => toggleCode(c.id)} title={[c.description, c.whenToUse && `Use when: ${c.whenToUse}`, c.whenNotToUse && `Not when: ${c.whenNotToUse}`].filter(Boolean).join('\n')}
                              className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm ${on ? 'border-indigo-300 bg-indigo-50' : 'border-stone-200 bg-white hover:border-stone-300'}`}>
                              <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${on ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-stone-300'}`}>{on ? '✓' : ''}</span>
                              <span className="flex-1">{c.label}{n > 0 && <span className="ml-1.5 rounded bg-yellow-100 px-1 text-[10px] text-yellow-800">{n} excerpt{n > 1 ? 's' : ''}</span>}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex gap-1.5">
                  <Input placeholder="New code" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCode()} />
                  <Input className="w-32" placeholder="Group" list="code-groups" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
                  <datalist id="code-groups">{[...new Set(review.codebook.map((c) => c.group).filter(Boolean))].map((g) => <option key={g} value={g} />)}</datalist>
                  <Button size="sm" onClick={addCode}>Add</Button>
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">Coded excerpts ({excerpts.length})</div>
                <div className="space-y-2">
                  <PasteExcerpt options={options} multi onAdd={addExcerpt} linkLabel="Codes" />
                  <EvidenceList items={excerpts} options={options} multi activeId={activeId}
                    onActivate={(h) => { setActiveId(h.id); if (h.rects?.length) viewer.current?.scrollTo(h); }}
                    onRelink={relink} onRemove={removeExcerpt}
                    empty="Select text in the PDF or paste a passage, and link it to the codes it supports." />
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">Extraction notes</div>
                <Textarea rows={4} placeholder="Summary, how the source answers the RQs, anything to discuss…" value={cur.note} onChange={(e) => setCoding({ note: e.target.value })} />
              </div>
            </div>
            <div className="border-t border-stone-200 bg-white p-4">
              <Button tone="primary" size="lg" className="w-full" onClick={finish}>{cur.done ? 'Save & next' : 'Mark coded & next'}</Button>
              {cur.done && <div className="mt-2 text-xs text-stone-400">Coded on {new Date(cur.codedAt).toLocaleString()}</div>}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

// Reports of the same study (PRISMA 2020 counts studies and reports separately).
function StudyLink({ record, pool }) {
  const { update } = useReview();
  const others = pool.filter((x) => x.id !== record.id && !x.studyOf);
  if (!others.length) return null;
  return (
    <label className="mt-2 flex items-center gap-2 text-xs text-stone-500" title="Link reports that describe the same study; PRISMA 2020 then reports studies and reports separately">
      <span className="shrink-0">Same study as</span>
      <Select className="!py-0.5 !text-xs" value={record.studyOf || ''} onChange={(e) => update((rv) => ({ ...rv, records: rv.records.map((x) => (x.id === record.id ? { ...x, studyOf: e.target.value || null } : x)) }))}>
        <option value="">(own study)</option>
        {others.map((x) => <option key={x.id} value={x.id}>{(x.authors[0] || '').split(',')[0]} {x.year}: {x.title.slice(0, 60)}</option>)}
      </Select>
    </label>
  );
}

const ORIGINS = [['a-priori', 'A priori (deductive)'], ['emergent', 'Emergent (inductive)']];

function Codebook() {
  const { review, update, reviewer } = useReview();
  const fileRef = useRef();
  const [showLog, setShowLog] = useState(false);
  const usage = useMemo(() => {
    const m = {};
    for (const rv of review.reviewers) for (const c of Object.values(decisionsOf(review, rv.id).coding || {})) for (const id of c.codes || []) m[id] = (m[id] || 0) + 1;
    return m;
  }, [review]);
  const finalUse = useMemo(() => {
    const m = {};
    for (const r of codingPool(review)) for (const id of finalCoding(review, r.id).codes) m[id] = (m[id] || 0) + 1;
    return m;
  }, [review]);
  const who = reviewer?.name || 'unknown';
  const log = (r, action, code, detail) => [...(r.codebookLog || []), codebookLogEntry(action, code, who, detail)];
  // Edits are logged once per code and field per minute, so typing does not flood the log.
  const set = (id, patch) => update((r) => {
    const code = r.codebook.find((c) => c.id === id);
    const field = Object.keys(patch)[0];
    const last = (r.codebookLog || []).at(-1);
    const recent = last && last.codeId === id && last.action === `edited ${field}` && Date.now() - new Date(last.at).getTime() < 60000;
    return { ...r, codebook: r.codebook.map((c) => (c.id === id ? { ...c, ...patch } : c)), codebookLog: recent ? r.codebookLog : log(r, `edited ${field}`, code) };
  });
  const remove = (c) => {
    if (usage[c.id] && !confirm(`"${c.label}" is applied ${usage[c.id]} time(s). Delete it anyway? Applied codes become "(deleted code)".`)) return;
    update((r) => ({ ...r, codebook: r.codebook.filter((x) => x.id !== c.id), codebookLog: log(r, 'deleted', c) }));
  };
  const add = (codes, detail) => update((r) => {
    const fresh = codes.filter((c) => !r.codebook.some((x) => x.label === c.label && x.group === c.group));
    return { ...r, codebook: [...r.codebook, ...fresh], codebookLog: [...(r.codebookLog || []), ...fresh.map((c) => codebookLogEntry('added', c, who, detail))] };
  });
  const move = (id, dir) => update((r) => {
    const arr = [...r.codebook]; const i = arr.findIndex((c) => c.id === id); const j = i + dir;
    if (j < 0 || j >= arr.length) return r;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return { ...r, codebook: arr };
  });
  const exportCodebook = () => {
    const data = { format: 'reviewhub-codebook', title: review.title, exportedAt: new Date().toISOString(),
      codes: review.codebook.map(({ id: _id, ...c }) => c) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'codebook.json' }).click();
    URL.revokeObjectURL(url);
  };
  const importCodebook = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const list = data.format === 'reviewhub-codebook' ? data.codes : Array.isArray(data) ? data : null;
      if (!list) throw new Error('not a codebook file');
      add(list.filter((c) => c.label).map((c) => ({ ...newCode({ label: c.label, group: c.group || '', origin: c.origin || 'a-priori', description: c.description || '' }), whenToUse: c.whenToUse || '', whenNotToUse: c.whenNotToUse || '', example: c.example || '' })), `imported from ${f.name}`);
    } catch (err) { alert(`Import failed: ${err.message}`); }
  };

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <SectionTitle
        title="Codebook"
        hint={guide(review, 'codebook')}
        actions={<>
          <Button onClick={() => add(codesFromQuestions(review), 'derived from the review questions')} title="Adds one top-level placeholder code per review question (group “Review questions”). Refine them into specific codes before coding">Codes from review questions</Button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={importCodebook} />
          <Button onClick={() => fileRef.current.click()} title="Add codes from a codebook file (e.g. exported from another review or drafted by Claude Code)">Import…</Button>
          <Button onClick={exportCodebook} disabled={!review.codebook.length}>Export</Button>
          <Button tone="primary" onClick={() => add([newCode()], 'added in codebook')}>+ Code</Button>
        </>}
      />
      {!review.codebook.length && (
        <Empty title="No codes yet">
          Start deductively: derive codes from your review questions, import a codebook, or ask Claude Code (running in this folder) to draft one from the protocol. Add emergent codes while coding.
        </Empty>
      )}
      <div className="space-y-2">
        {review.codebook.map((c) => (
          <Card key={c.id} className="flex items-start gap-3 p-3">
            <div className="grid flex-1 grid-cols-[12rem_1fr] gap-2">
              <Input placeholder="Group" list="cb-groups" value={c.group} onChange={(e) => set(c.id, { group: e.target.value })} />
              <Input placeholder="Code label" value={c.label} onChange={(e) => set(c.id, { label: e.target.value })} />
              <div className="space-y-1 text-xs text-stone-400">
                <div>{usage[c.id] || 0} applications · {finalUse[c.id] || 0} final</div>
                <Select className="!py-0.5 !text-xs" value={c.origin || 'a-priori'} onChange={(e) => set(c.id, { origin: e.target.value })}>
                  {ORIGINS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Textarea rows={1} placeholder="Definition: what the code means" value={c.description} onChange={(e) => set(c.id, { description: e.target.value })} />
                <details className="text-xs" open={!!(c.whenToUse || c.whenNotToUse || c.example)}>
                  <summary className="cursor-pointer text-stone-500">Rules and example</summary>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    <Textarea rows={2} placeholder="Use when…" value={c.whenToUse || ''} onChange={(e) => set(c.id, { whenToUse: e.target.value })} />
                    <Textarea rows={2} placeholder="Do not use when…" value={c.whenNotToUse || ''} onChange={(e) => set(c.id, { whenNotToUse: e.target.value })} />
                    <Textarea rows={2} className="col-span-2" placeholder="Example (quote or paraphrase from a source)" value={c.example || ''} onChange={(e) => set(c.id, { example: e.target.value })} />
                  </div>
                </details>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Button tone="ghost" size="sm" onClick={() => move(c.id, -1)}>↑</Button>
              <Button tone="ghost" size="sm" onClick={() => move(c.id, 1)}>↓</Button>
              <Button tone="ghost" size="sm" onClick={() => remove(c)}>✕</Button>
            </div>
          </Card>
        ))}
      </div>
      <datalist id="cb-groups">{[...new Set(review.codebook.map((c) => c.group).filter(Boolean))].map((g) => <option key={g} value={g} />)}</datalist>

      <section className="mt-10">
        <button className="text-sm font-medium underline" onClick={() => setShowLog(!showLog)}>
          {showLog ? 'Hide' : 'Show'} codebook change log ({(review.codebookLog || []).length})
        </button>
        {showLog && (
          <Card className="mt-3 max-h-96 divide-y divide-stone-100 overflow-auto text-xs">
            {[...(review.codebookLog || [])].reverse().map((e, i) => (
              <div key={i} className="flex gap-3 px-4 py-1.5">
                <span className="w-36 shrink-0 tabular-nums text-stone-400">{new Date(e.at).toLocaleString()}</span>
                <span className="w-28 shrink-0 text-stone-500">{e.by}</span>
                <span><b>{e.action}</b> {e.label || '(unnamed)'}{e.detail ? <span className="text-stone-500"> · {e.detail}</span> : null}</span>
              </div>
            ))}
            {!(review.codebookLog || []).length && <div className="px-4 py-3 text-stone-500">No changes logged yet.</div>}
          </Card>
        )}
      </section>
    </div>
  );
}
