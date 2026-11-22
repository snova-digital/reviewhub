import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useReview } from '../lib/store.jsx';
import { reviewStages } from '../lib/progress.js';
import PrismaDiagram from '../components/PrismaDiagram.jsx';
import { appraisalPool, assignmentLabel, codingPool, decisionsOf, ftPool, isAssigned, uniqueRecords, workStagesFor } from '../lib/model.js';
import { guide, profileOf } from '../lib/methods.js';
import { Band, Card, Progress, SectionTitle } from '../components/ui.jsx';

const STAGE_ROUTE = { ta: 'screen/ta', ft: 'screen/ft', coding: 'code', appraisal: 'appraise' };

// Per reviewer and work stage: how many records are assigned and how many they have done.
function workOf(review, rv, pools) {
  const d = decisionsOf(review, rv.id);
  return workStagesFor(review).filter((st) => rv.assignment?.[st.key]?.mode !== 'none').map((st) => {
    const assigned = pools[st.key].filter((r) => isAssigned(rv, st.key, r.id));
    const done = st.key === 'coding' || st.key === 'appraisal'
      ? assigned.filter((r) => d[st.key]?.[r.id]?.done).length
      : assigned.filter((r) => d.screening[st.key][r.id]).length;
    return { ...st, assigned: assigned.length, done };
  });
}

export default function OverviewPage() {
  const { review, reviewer } = useReview();
  const { steps, current, gaps, counts: c, conflicts } = useMemo(() => reviewStages(review), [review]);
  const pools = useMemo(() => ({ ta: uniqueRecords(review), ft: ftPool(review), coding: codingPool(review), appraisal: appraisalPool(review) }), [review]);
  const myWork = reviewer ? workOf(review, reviewer, pools) : [];
  // A stage's work only counts as "waiting for you" once the step before it is final: until then records
  // can still arrive in (or drop out of) its pool, so the numbers would mislead.
  const isDone = (key) => steps.find((s) => s.key === key)?.done;
  const ready = { ta: true, ft: isDone('ta'), coding: isDone('ft'), appraisal: isDone('ft') };
  const myOpen = myWork.filter((w) => ready[w.key] && w.done < w.assigned);
  const upcoming = myWork.find((w) => !ready[w.key] && w.assigned > 0);
  const p = review.protocol;
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div>
      <Band tone="teal" inner="pb-12 pt-10">
        <div className="text-sm font-light text-white/90">{profileOf(review).short} · {profileOf(review).methodology} / {profileOf(review).guideline}</div>
        <h1 className="brand-bar mt-2 max-w-4xl text-4xl font-bold leading-tight">{review.title}</h1>
        {p.objective
          ? <p className="mt-6 max-w-3xl text-lg font-light leading-relaxed">{p.objective}</p>
          : <p className="mt-6 text-lg font-light">No objective yet. <Link to="protocol" className="underline">Define the protocol</Link>.</p>}
      </Band>

      <div className="mx-auto max-w-4xl space-y-14 px-8 py-12">
        {/* 1. Where the review is right now and what to do next */}
        <section>
          <SectionTitle title="Where the review stands" hint={`${doneCount} of ${steps.length} steps complete.`} />
          <Card className="overflow-hidden">
            <div className="border-l-4 border-brand-teal p-6">
              <div className="text-xs font-medium uppercase tracking-[0.15em] text-stone-500">current step</div>
              <div className="mt-1 text-2xl font-bold lowercase">{current.label}</div>
              <p className="mt-2 text-sm text-stone-700">{current.detail}</p>
              {current.progress?.total > 0 && <div className="mt-4 max-w-xl"><Progress value={current.progress.value} total={current.progress.total} /></div>}
              <Link to={current.to} className="mt-5 inline-flex items-center gap-2 bg-black px-4 py-2 text-sm font-medium text-white hover:bg-brand-teal">
                go to {current.label.toLowerCase()} →
              </Link>
              {gaps.length > 0 && (
                <div className="mt-6 border-t border-stone-200 pt-4">
                  <div className="text-xs font-medium uppercase tracking-[0.15em] text-stone-500">still open from earlier steps</div>
                  {gaps.map((g) => (
                    <Link key={g.key} to={g.to} className="mt-1 block text-sm hover:underline">
                      <span className="font-medium lowercase">{g.label}</span> <span className="text-stone-600">· {g.detail}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            {(conflicts > 0 || reviewer) && (
              <div className="grid gap-px border-t border-stone-200 bg-stone-200 sm:grid-cols-2">
                <div className="bg-white p-5">
                  <div className="text-xs font-medium uppercase tracking-[0.15em] text-stone-500">needs consensus</div>
                  {conflicts > 0
                    ? <Link to="compare" className="mt-1 block text-sm text-rose-700 hover:underline">{conflicts} open conflict{conflicts === 1 ? '' : 's'} between reviewers → compare &amp; consensus</Link>
                    : <p className="mt-1 text-sm text-stone-600">No open conflicts.</p>}
                </div>
                {reviewer && (
                  <div className="bg-white p-5">
                    <div className="text-xs font-medium uppercase tracking-[0.15em] text-stone-500">your work · {reviewer.name}</div>
                    {myOpen.length === 0
                      ? <p className="mt-1 text-sm text-stone-600">{upcoming ? `Nothing waiting right now. ${upcoming.label} opens once the step before it is final.` : 'Nothing assigned to you is waiting.'}</p>
                      : myOpen.map((w) => (
                        <Link key={w.key} to={STAGE_ROUTE[w.key]} className="mt-1 block text-sm hover:underline">
                          {w.assigned - w.done} left in {w.label.toLowerCase()} <span className="text-stone-500">({w.done}/{w.assigned} done)</span>
                        </Link>
                      ))}
                  </div>
                )}
              </div>
            )}
          </Card>
          {c.unique > 0 && c.taScreened === 0 && (
            <p className="mt-3 text-xs leading-relaxed text-stone-500">
              {guide(review, 'pilotTip')}
            </p>
          )}
        </section>

        {/* 2. Every step with its real numbers */}
        <section>
          <SectionTitle title="Progress" hint="Final decisions only: consensus, or agreement of the human reviewers. Open conflicts count as undecided." />
          <Card className="divide-y divide-stone-100">
            {steps.map((s, i) => (
              <Link key={s.key} to={s.to} className={`flex items-start gap-4 px-5 py-4 hover:bg-stone-50 ${s === current ? 'bg-stone-50' : ''}`}>
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${s.done ? 'bg-black text-white' : s === current ? 'border-2 border-black' : 'border border-stone-300 text-stone-400'}`}>
                  {s.done ? '✓' : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={`font-medium lowercase ${s.done ? 'text-stone-500' : ''}`}>{s.label}</span>
                    {s.attention > 0 && <span className="shrink-0 text-xs text-rose-600">{s.attention} conflict{s.attention === 1 ? '' : 's'}</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-stone-500">{s.detail}</div>
                  {s.progress?.total > 0 && s.key !== 'protocol' && <div className="mt-2"><Progress value={s.progress.value} total={s.progress.total} /></div>}
                </div>
              </Link>
            ))}
          </Card>
        </section>

        {/* 3. PRISMA flow */}
        <section>
          <SectionTitle title={guide(review, 'flow')} hint="Updates live from the final screening decisions." />
          <Card className="p-5"><PrismaDiagram c={c} /></Card>
        </section>

        {/* 4. Reviewers */}
        <section>
          <SectionTitle title="Reviewers" hint="Each reviewer's own decisions against their assigned workload." actions={<Link to="reviewers" className="text-sm underline">manage</Link>} />
          <Card className="divide-y divide-stone-100">
            {review.reviewers.length === 0 && <div className="p-5 text-sm text-stone-500">No reviewers yet.</div>}
            {review.reviewers.map((rv) => (
              <div key={rv.id} className="grid gap-4 p-5 sm:grid-cols-[12rem_1fr]">
                <div className="text-sm font-medium">
                  {rv.name}
                  {rv.type === 'llm' && <span className="ml-1 text-xs font-normal text-indigo-700">LLM</span>}
                  {rv.id === reviewer?.id && <span className="ml-1 text-xs font-normal text-stone-500">(you)</span>}
                </div>
                <div className="space-y-2">
                  {workOf(review, rv, pools).map((w) => (
                    <div key={w.key}>
                      <div className="text-[11px] text-stone-500">{w.label} · {assignmentLabel(rv, w.key)}</div>
                      <Progress value={w.done} total={w.assigned} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        </section>
      </div>
    </div>
  );
}
