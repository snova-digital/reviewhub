import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { assignmentLabel, criteriaFor, criterionState, DECISIONS, DECISION_LABEL, failedCriteria, PAIRED_STATES, reasonCriteria, reasonLabel, suggestDecision, criterionCode } from '../lib/model.js';
import { Button, Kbd, Select, Textarea, Progress } from './ui.jsx';

// Main screening vs. calibration ("demo") round on the first N records. Kept in the URL (?cal=1).
export function useScope() {
  const [params, setParams] = useSearchParams();
  const scope = params.get('cal') ? 'calibration' : 'screening';
  const setScope = (s) => setParams(s === 'calibration' ? { cal: '1' } : {});
  return [scope, setScope];
}

// ---- queue navigation over an ordered pool --------------------------------
export function useQueue(pool, decisions) {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('pending');
  const history = useRef([]);
  const matches = useCallback((r) => (filter === 'all' ? true : filter === 'pending' ? !decisions[r.id] : decisions[r.id]?.decision === filter), [filter, decisions]);

  const requested = params.get('rec');
  const current = useMemo(() => {
    if (requested) { const r = pool.find((x) => x.id === requested); if (r) return r; }
    return pool.find(matches) || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested, pool, filter]);

  const go = useCallback((id, push = true) => {
    if (push && current) history.current.push(current.id);
    setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('rec', id); else n.delete('rec'); return n; }, { replace: false });
  }, [current, setParams]);

  const idx = current ? pool.findIndex((r) => r.id === current.id) : -1;
  const next = useCallback((decisionsOverride) => {
    const d = decisionsOverride || decisions;
    const ok = (r) => (filter === 'all' ? true : filter === 'pending' ? !d[r.id] : d[r.id]?.decision === filter);
    for (let k = 1; k <= pool.length; k++) {
      const r = pool[(idx + k) % pool.length];
      if (r && r.id !== current?.id && ok(r)) return go(r.id);
    }
    go(null);
  }, [pool, idx, filter, decisions, current, go]);

  const prev = useCallback(() => {
    const id = history.current.pop();
    if (id) return go(id, false);
    if (idx > 0) go(pool[idx - 1].id, false);
  }, [idx, pool, go]);

  const done = pool.filter((r) => decisions[r.id]).length;
  const clearRec = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('rec'); return n; });
  return { current, idx, next, prev, filter, setFilter: (f) => { setFilter(f); clearRec(); }, done, total: pool.length };
}

const STAGE_TITLE = { ta: 'Title / abstract screening', ft: 'Full-text screening', coding: 'Extraction & coding', appraisal: 'Critical appraisal' };

export function QueueBar({ q, stage, scope, setScope, reviewer, calibrationSize, children }) {
  return (
    <div className="border-b border-stone-200 bg-white">
      <div className="flex items-center gap-4 px-6 py-2.5">
        <div className="text-sm font-medium">{STAGE_TITLE[stage]}</div>
        <div className="w-72"><Progress value={q.done} total={q.total} /></div>
        <div className="w-48">
          <Select value={q.filter} onChange={(e) => q.setFilter(e.target.value)}>
            <option value="pending">{stage === 'coding' ? 'Not yet coded' : stage === 'appraisal' ? 'Not yet appraised' : 'Not yet screened'}</option>
            <option value="all">All in this stage</option>
            {DECISIONS[stage]?.map((d) => <option key={d.value} value={d.value}>Decided: {d.label}</option>)}
          </Select>
        </div>
        {setScope && (
          <div className="flex rounded-md ring-1 ring-stone-300 text-xs">
            <button className={`rounded-l-md px-2.5 py-1 ${scope === 'screening' ? 'bg-stone-800 text-white' : 'hover:bg-stone-100'}`} onClick={() => setScope('screening')}>Main screening</button>
            <button className={`rounded-r-md px-2.5 py-1 ${scope === 'calibration' ? 'bg-amber-500 text-white' : 'hover:bg-stone-100'}`} onClick={() => setScope('calibration')} title="Practice round on the first records, stored separately from the main screening">Calibration (first {calibrationSize})</button>
          </div>
        )}
        {children}
        <div className="ml-auto flex items-center gap-2 text-xs text-stone-500">
          <span className="tabular-nums">#{q.idx + 1} of {q.total}</span>
          <Button size="sm" onClick={q.prev}>← Prev</Button>
          <Button size="sm" onClick={() => q.next()}>Skip →</Button>
        </div>
      </div>
      {(scope === 'calibration' || reviewer?.type === 'llm' || reviewer?.assignment?.[stage]?.mode === 'sample') && (
        <div className={`px-6 py-1.5 text-xs ${scope === 'calibration' ? 'bg-amber-50 text-amber-900' : 'bg-indigo-50 text-indigo-900'}`}>
          {scope === 'calibration' && <>Calibration round: decisions here are stored separately and do not count for PRISMA. Compare them under <b>Compare &amp; consensus → Calibration</b>. </>}
          {reviewer?.assignment?.[stage]?.mode === 'sample' && scope !== 'calibration' && <>You are cross-checking a random {assignmentLabel(reviewer, stage)} of this stage. </>}
          {reviewer?.type === 'llm' && <>You are entering decisions on behalf of the LLM reviewer <b>{reviewer.name}</b>{reviewer.model ? ` (${reviewer.model})` : ''}. LLM decisions are compared but never final.</>}
        </div>
      )}
    </div>
  );
}

// ---- decision form state ---------------------------------------------------
// `mine` = the active reviewer's decision map for this stage and scope.
export function useDecisionForm(review, stage, record, mine) {
  const existing = record ? mine[record.id] : null;
  const [checked, setChecked] = useState([]);
  const [marks, setMarks] = useState({});
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setChecked(existing?.checked || []);
    // Paired criteria: explicit marks, or derived from older decisions (ticks, merged exclusion criteria).
    setMarks(Object.fromEntries(criteriaFor(review, stage).filter((c) => c.kind === 'paired')
      .map((c) => [c.id, criterionState(existing, c)]).filter(([, v]) => v)));
    setDecision(existing?.decision || null);
    setReason(existing?.reason || '');
    setNote(existing?.note || '');
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id]);

  const suggested = suggestDecision(review, stage, checked, marks);
  const toggle = (id) => { setTouched(true); setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id])); };
  // Set a paired criterion to meets | unclear | fails, or clear it (null / same state again).
  const setMark = (id, state) => {
    setTouched(true);
    setMarks((m) => {
      const { [id]: cur, ...rest } = m;
      return !state || cur === state ? rest : { ...rest, [id]: state };
    });
  };
  const effective = decision || (touched ? suggested : null);
  const failed = failedCriteria(review, stage, { checked, marks }).map((c) => c.id);
  const effectiveReason = reason || failed[0] || '';
  // Ids whose state is carried by `marks`: paired criteria and the exclusion criteria merged into them.
  const pairedIds = review.criteria.filter((c) => c.kind === 'paired').flatMap((c) => [c.id, ...(c.mergedFrom || [])]);

  return {
    existing, checked, toggle, marks, setMark, pairedIds, decision: effective, setDecision, suggested, reason: effectiveReason, setReason, note, setNote, failed,
  };
}

export function buildDecision(form, extra, reviewer) {
  const prev = form.existing;
  const { history: _h, ...prevNoHist } = prev || {};
  const marks = form.marks || {};
  const paired = form.pairedIds || [];
  // `checked` also lists the paired criteria that are met (for tools that only read `checked`).
  const checked = [...form.checked.filter((id) => !paired.includes(id)), ...Object.keys(marks).filter((id) => marks[id] === 'meets')];
  return {
    decision: form.decision,
    checked,
    ...(paired.length ? { marks } : {}),
    reason: form.decision === 'exclude' ? form.reason || null : null,
    note: form.note,
    reviewer: reviewer || '',
    decidedAt: new Date().toISOString(),
    ...extra,
    history: prev ? [...(prev.history || []), prevNoHist] : [],
  };
}

// ---- checklist -------------------------------------------------------------
export function CriteriaChecklist({ review, stage, form, evidenceCount }) {
  const crit = criteriaFor(review, stage);
  const inc = crit.filter((c) => c.kind === 'inclusion');
  const paired = crit.filter((c) => c.kind === 'paired');
  const groupNames = [...new Set(inc.filter((c) => c.group).map((c) => c.group))];
  const sections = [
    { key: 'pair', kind: 'paired', title: 'Eligibility criteria: judge each (1–9 cycles meets → unclear → fails)', list: paired },
    { key: 'inc', kind: 'inclusion', title: 'Inclusion criteria: tick if met', list: inc.filter((c) => !c.group) },
    ...groupNames.map((g) => ({ key: `g-${g}`, kind: 'inclusion', title: `${g}: at least one must be met`, list: inc.filter((c) => c.group === g) })),
    { key: 'exc', kind: 'exclusion', title: 'Exclusion criteria: tick if applies', list: crit.filter((c) => c.kind === 'exclusion') },
  ];
  let n = 0;
  if (!crit.length) return <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">No criteria defined for this stage yet. Add them under Protocol & criteria.</div>;
  return (
    <div className="space-y-4">
      {sections.map(({ key, kind, title, list }) => {
        if (!list.length) return null;
        return (
          <div key={key}>
            <div className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wide ${{ inclusion: 'text-emerald-700', exclusion: 'text-rose-700' }[kind] || 'text-stone-600'}`}>{title}</div>
            <div className="space-y-1">
              {list.map((c) => {
                n += 1;
                if (kind === 'paired') return <PairedRow key={c.id} review={review} c={c} n={n} form={form} evidence={evidenceCount?.[c.id]} />;
                const on = form.checked.includes(c.id);
                const on_cls = kind === 'inclusion' ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50';
                return (
                  <button
                    key={c.id}
                    type="button"
                    data-crit-key={n}
                    onClick={() => form.toggle(c.id)}
                    className={`flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2 text-left text-sm transition ${on ? on_cls : 'border-stone-200 bg-white hover:border-stone-300'}`}
                  >
                    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${on ? (kind === 'inclusion' ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-rose-600 bg-rose-600 text-white') : 'border-stone-300'}`}>{on ? '✓' : ''}</span>
                    <span className="flex-1 leading-snug">
                      <span className="mr-1 font-semibold text-stone-500">{criterionCode(review, c.id)}</span>{c.text}
                      {evidenceCount?.[c.id] > 0 && <span className="ml-1.5 rounded bg-yellow-100 px-1 text-[10px] text-yellow-800">{evidenceCount[c.id]} evidence</span>}
                    </span>
                    {n <= 9 && <Kbd>{n}</Kbd>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// One paired criterion: inclusion side and exclusion side in one row, judged meets | unclear | fails.
const MARK_STYLE = {
  meets: { row: 'border-emerald-300 bg-emerald-50', on: 'bg-emerald-600 text-white ring-emerald-600', off: 'text-emerald-800 ring-emerald-200 hover:bg-emerald-50' },
  unclear: { row: 'border-amber-300 bg-amber-50', on: 'bg-amber-500 text-white ring-amber-500', off: 'text-amber-800 ring-amber-200 hover:bg-amber-50' },
  fails: { row: 'border-rose-300 bg-rose-50', on: 'bg-rose-600 text-white ring-rose-600', off: 'text-rose-800 ring-rose-200 hover:bg-rose-50' },
};
const CYCLE = { undefined: 'meets', meets: 'unclear', unclear: 'fails', fails: null };

function PairedRow({ review, c, n, form, evidence }) {
  const state = form.marks?.[c.id];
  return (
    <div className={`rounded-md border px-2.5 py-2 text-sm transition ${state ? MARK_STYLE[state].row : 'border-stone-200 bg-white'}`}>
      {/* Hidden target for the 1–9 keyboard shortcut: cycles the state. */}
      <button type="button" data-crit-key={n} className="hidden" onClick={() => form.setMark(c.id, CYCLE[state] ?? null)} />
      <div className="flex items-start gap-2">
        <span className="font-semibold text-stone-500">{criterionCode(review, c.id)}</span>
        <div className="flex-1 space-y-0.5 leading-snug">
          <div><span className="mr-1 text-[10px] font-semibold uppercase text-emerald-700">in</span>{c.text}</div>
          {c.excludeText && <div className="text-stone-600"><span className="mr-1 text-[10px] font-semibold uppercase text-rose-700">out</span>{c.excludeText}</div>}
          {evidence > 0 && <span className="rounded bg-yellow-100 px-1 text-[10px] text-yellow-800">{evidence} evidence</span>}
        </div>
        {n <= 9 && <Kbd>{n}</Kbd>}
      </div>
      <div className="mt-1.5 flex gap-1 pl-8">
        {PAIRED_STATES.map((s) => (
          <button key={s.value} type="button" onClick={() => form.setMark(c.id, s.value)}
            className={`rounded px-2 py-0.5 text-xs font-medium ring-1 ${state === s.value ? MARK_STYLE[s.value].on : MARK_STYLE[s.value].off}`}>
            {s.short} {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DecisionPanel({ review, stage, form, onSave, saving, requireReason }) {
  const options = DECISIONS[stage];
  const excl = reasonCriteria(review, stage);
  const missingReason = requireReason && form.decision === 'exclude' && !form.reason;
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-stone-500">
          Decision
          {form.suggested && <span className="font-normal normal-case text-stone-400">checklist suggests: <b>{DECISION_LABEL[form.suggested]}</b></span>}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {options.map((o) => {
            const on = form.decision === o.value;
            const cls = {
              emerald: on ? 'bg-emerald-600 text-white ring-emerald-600' : 'text-emerald-800 ring-emerald-200 hover:bg-emerald-50',
              amber: on ? 'bg-amber-500 text-white ring-amber-500' : 'text-amber-800 ring-amber-200 hover:bg-amber-50',
              rose: on ? 'bg-rose-600 text-white ring-rose-600' : 'text-rose-800 ring-rose-200 hover:bg-rose-50',
              stone: on ? 'bg-stone-600 text-white ring-stone-600' : 'text-stone-700 ring-stone-300 hover:bg-stone-100',
            }[o.tone];
            return (
              <button key={o.value} type="button" onClick={() => form.setDecision(o.value)} className={`rounded-md px-2 py-2 text-xs font-medium ring-1 transition ${cls}`}>
                {o.label} <span className="opacity-60">({o.key.toUpperCase()})</span>
              </button>
            );
          })}
        </div>
      </div>
      {form.decision === 'exclude' && excl.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500">Primary exclusion reason {requireReason && <span className="text-rose-600">(required for PRISMA)</span>}</div>
          <Select value={form.reason} onChange={(e) => form.setReason(e.target.value)}>
            <option value="">— select —</option>
            {excl.map((c) => <option key={c.id} value={c.id}>{reasonLabel(review, c.id)}</option>)}
          </Select>
        </div>
      )}
      <Textarea rows={2} placeholder="Note (optional): why, doubts, what makes it ambiguous, things to discuss with co-reviewer…" value={form.note} onChange={(e) => form.setNote(e.target.value)} />
      <Button tone="primary" size="lg" className="w-full" disabled={!form.decision || saving || missingReason} onClick={onSave}>
        {saving ? 'Saving…' : 'Save & next'} <Kbd>⏎</Kbd>
      </Button>
      {form.existing && (
        <div className="text-xs text-stone-400">
          You decided: <b>{DECISION_LABEL[form.existing.decision] || form.existing.decision}</b> on {new Date(form.existing.decidedAt).toLocaleString()}
          {form.existing.history?.length > 0 && ` · ${form.existing.history.length} earlier revision(s)`}
        </div>
      )}
    </div>
  );
}

// Keyboard shortcuts shared by both stages.
export function useScreeningKeys({ form, stage, onSave, q, enabled = true }) {
  useEffect(() => {
    if (!enabled) return;
    const h = (e) => {
      const t = e.target;
      if (t.closest?.('input, textarea, select, [contenteditable]')) {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSave(); }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (/^[1-9]$/.test(key)) {
        document.querySelector(`[data-crit-key="${key}"]`)?.click();
        e.preventDefault();
      } else if (key === 'enter') { e.preventDefault(); onSave(); }
      else if (key === 'arrowright') q.next();
      else if (key === 'arrowleft') q.prev();
      else {
        const opt = DECISIONS[stage].find((o) => o.key === key);
        if (opt) form.setDecision(opt.value);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [form, stage, onSave, q, enabled]);
}
