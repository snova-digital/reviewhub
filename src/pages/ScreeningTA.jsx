import { useCallback, useMemo, useState } from 'react';
import { useReview } from '../lib/store.jsx';
import { calibrationSet, decisionsOf, isAssigned, uniqueRecords } from '../lib/model.js';
import { buildDecision, CriteriaChecklist, DecisionPanel, QueueBar, useDecisionForm, useQueue, useScope, useScreeningKeys } from '../components/Screening.jsx';
import { Card, Empty, Kbd } from '../components/ui.jsx';
import { guide } from '../lib/methods.js';

function termRegex(terms) {
  const t = terms.map((s) => s.trim()).filter(Boolean)
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '\\w*'));
  return t.length ? new RegExp(`\\b(${t.join('|')})`, 'gi') : null;
}

function Highlighted({ text, inc, exc }) {
  if (!text) return null;
  if (!inc && !exc) return text;
  const marks = [];
  for (const [re, cls] of [[inc, 'term-inc'], [exc, 'term-exc']]) {
    if (!re) continue;
    for (const m of text.matchAll(re)) marks.push([m.index, m.index + m[0].length, cls]);
  }
  marks.sort((a, b) => a[0] - b[0]);
  const out = [];
  let pos = 0;
  for (const [s, e, cls] of marks) {
    if (s < pos) continue;
    out.push(text.slice(pos, s), <mark key={s} className={cls}>{text.slice(s, e)}</mark>);
    pos = e;
  }
  out.push(text.slice(pos));
  return out;
}

export default function ScreeningTA() {
  const { review, updateMine, me, reviewer } = useReview();
  const [scope, setScope] = useScope();
  const pool = useMemo(
    () => (scope === 'calibration' ? calibrationSet(review, 'ta') : uniqueRecords(review).filter((r) => isAssigned(reviewer, 'ta', r.id))),
    [review, scope, reviewer],
  );
  const mine = decisionsOf(review, me)[scope].ta;
  const q = useQueue(pool, mine);
  const form = useDecisionForm(review, 'ta', q.current, mine);
  const [saving, setSaving] = useState(false);
  const inc = useMemo(() => termRegex(review.protocol.highlightTerms.include), [review.protocol.highlightTerms]);
  const exc = useMemo(() => termRegex(review.protocol.highlightTerms.exclude), [review.protocol.highlightTerms]);
  const runName = useMemo(() => Object.fromEntries(review.runs.map((r) => [r.id, r.database])), [review.runs]);

  const save = useCallback(async () => {
    if (!q.current || !form.decision || saving) return;
    setSaving(true);
    const rec = q.current;
    const d = buildDecision(form, {}, reviewer.name);
    let nextTa;
    await updateMine((dec) => {
      nextTa = { ...dec[scope].ta, [rec.id]: d };
      return { ...dec, [scope]: { ...dec[scope], ta: nextTa } };
    });
    setSaving(false);
    q.next(nextTa);
  }, [q, form, saving, updateMine, reviewer, scope]);

  useScreeningKeys({ form, stage: 'ta', onSave: save, q });

  const r = q.current;
  const bar = <QueueBar q={q} stage="ta" scope={scope} setScope={setScope} reviewer={reviewer} calibrationSize={review.settings.calibrationSize || 20} />;
  if (!pool.length) {
    return (
      <div className="flex h-full flex-col">{bar}<div className="p-8">
        {reviewer.assignment?.ta?.mode === 'none'
          ? <Empty title="You are not participating in title/abstract screening">Change your assignment under Reviewers.</Empty>
          : <Empty title="Nothing to screen yet">Import search results first.</Empty>}
      </div></div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {bar}
      {!r ? (
        <div className="p-8"><Empty title="All records in this view are screened 🎉">Switch the filter to review earlier decisions, or continue with full-text screening.</Empty></div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-auto px-10 py-8">
            <article className="mx-auto max-w-3xl">
              <div className="mb-3 flex flex-wrap gap-x-3 text-xs text-stone-500">
                <span>{r.year}</span><span>{r.journal}</span><span>{r.type}</span><span>via {runName[r.runId]}</span>
                {r.doi && <a className="text-indigo-700 hover:underline" href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">doi:{r.doi}</a>}
              </div>
              <h1 className="text-[26px] font-normal leading-snug"><Highlighted text={r.title} inc={inc} exc={exc} /></h1>
              <div className="mt-2 text-sm text-stone-600">{r.authors.slice(0, 8).join('; ')}{r.authors.length > 8 ? ' et al.' : ''}</div>

              <section className="mt-6">
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Abstract</h2>
                <p className="mt-2 text-[17px] font-light leading-relaxed text-black">
                  {r.abstract ? <Highlighted text={r.abstract} inc={inc} exc={exc} /> : <i className="text-stone-400">No abstract available. Consider “Review with full text”.</i>}
                </p>
              </section>

              <section className="mt-6">
                <h2 className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Keywords</h2>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.keywords.length ? r.keywords.map((k) => (
                    <span key={k} className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-700"><Highlighted text={k} inc={inc} exc={exc} /></span>
                  )) : <i className="text-sm text-stone-400">None</i>}
                </div>
              </section>
            </article>
          </div>

          <aside className="flex w-[400px] shrink-0 flex-col gap-5 overflow-auto border-l border-stone-200 bg-stone-50 p-5">
            <CriteriaChecklist review={review} stage="ta" form={form} />
            <Card className="p-4"><DecisionPanel review={review} stage="ta" form={form} onSave={save} saving={saving} /></Card>
            <div className="text-[11px] leading-relaxed text-stone-400">
              <Kbd>1</Kbd>–<Kbd>9</Kbd> toggle criteria · <Kbd>I</Kbd> include · <Kbd>F</Kbd> review with full text · <Kbd>E</Kbd> exclude · <Kbd>⏎</Kbd> save &amp; next · <Kbd>←</Kbd><Kbd>→</Kbd> navigate.
              {guide(review, 'basket')}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
