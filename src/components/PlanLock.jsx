// UI for the lead reviewer and the official start of a review (rules and data in lib/lock.js).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useReview } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { reviewStages } from '../lib/progress.js';
import {
  acknowledgeChanges, calibrationStarted, calibrationStreams, calibrationSummary, canManage, changeCalibration, canRevert, isStarted, leadsOf, mainDecisionCount, planChanges,
  restartReview, revertChanges, startCalibration, startReview, workBlock,
} from '../lib/lock.js';
import { guide } from '../lib/methods.js';
import { calibrationPool, calibrationSet, decisionsOf, isHuman, uniqueRecords } from '../lib/model.js';
import { Badge, Button, Card, Field, Input, Select, Textarea } from './ui.jsx';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const nameOf = (review, id) => review.reviewers.find((r) => r.id === id)?.name || 'a former reviewer';
const leadNames = (review) => leadsOf(review).map((r) => r.name).join(', ');
const countOf = (log, kind, word) => { const n = log.filter((e) => e.kind === kind).length; return n ? ` · ${n} ${word}${n === 1 ? '' : 's'}` : ''; };

// Can the active reviewer edit the frozen plan right now?
//   manage   – lead (or anyone, while no lead is set)
//   editable – manage, and the review has not started, or the lead is amending, or changes are already pending
export function usePlanAccess() {
  const { review, me, amending } = useReview();
  const changes = useMemo(() => planChanges(review), [review]);
  const manage = canManage(review, me);
  const started = isStarted(review);
  return { manage, started, changes, editable: manage && (!started || amending || changes.length > 0) };
}

// Wrap editable controls: disables every input, select, textarea and button inside. `contents` keeps the layout.
export function ReadOnly({ when, children }) {
  return <fieldset disabled={!!when} className="contents">{children}</fieldset>;
}

// ---- banner for the plan pages (protocol, searches, settings) ------------------------------------
export function PlanBanner({ what }) {
  const { review, setAmending, amending } = useReview();
  const { manage, started, changes, editable } = usePlanAccess();
  const lock = review.lock;
  if (changes.length) return <div className="mb-6"><ChangesPanel /></div>;
  const box = 'mb-6 flex items-start gap-4 border-l-4 px-4 py-3 text-sm';
  if (!manage) {
    return (
      <div className={`${box} border-stone-400 bg-stone-100 text-stone-700`}>
        <span className="flex-1">
          <b>Read-only.</b> Only the lead reviewer ({leadNames(review)}) can change the {what}.
          {started && <> The plan is frozen since the review started on {fmtDate(lock.startedAt)}.</>}
        </span>
      </div>
    );
  }
  if (!started) {
    return (
      <div className={`${box} border-brand-yellow bg-amber-50 text-stone-800`}>
        <span className="flex-1">
          {leadsOf(review).length ? <>You are the lead reviewer and can edit the {what}.</> : <>No lead reviewer is set, so every human reviewer can edit the {what}. <Link to="../reviewers" className="underline">Make someone lead</Link>.</>}
          {' '}When everything is ready, start the review on the <Link to=".." className="underline">overview</Link>: from then on the plan is frozen.
        </span>
      </div>
    );
  }
  if (amending && editable) {
    return (
      <div className={`${box} border-rose-500 bg-rose-50 text-rose-900`}>
        <span className="flex-1"><b>Amending the frozen plan.</b> Any change you make pauses screening for every reviewer until you acknowledge it as a protocol amendment, undo it, or restart the review.</span>
        <Button size="sm" onClick={() => setAmending(false)}>Stop amending</Button>
      </div>
    );
  }
  return (
    <div className={`${box} border-black bg-stone-100 text-stone-800`}>
      <span className="flex-1">
        <b>Frozen</b> since {nameOf(review, lock.startedBy)} started the review on {fmtDate(lock.startedAt)}. {guide(review, 'deviation')}
      </span>
      <Button size="sm" onClick={() => setAmending(true)} title="Unlock the plan in this tab. Changes pause screening until you resolve them.">Amend…</Button>
    </div>
  );
}

// ---- pending changes: list + the lead's three ways to resolve them --------------------------------
function ChangeList({ changes }) {
  return (
    <ul className="mt-3 space-y-1.5">
      {changes.map((c, i) => (
        <li key={i} className="text-sm">
          <span className="font-medium">{c.label}</span>
          {(c.before || c.after) && (
            <details className="ml-1 inline">
              <summary className="inline cursor-pointer text-xs text-stone-500 underline">details</summary>
              <div className="mt-1 grid gap-2 bg-white p-2 text-xs sm:grid-cols-2">
                <div><div className="font-medium text-stone-500">before</div><div className="whitespace-pre-wrap text-stone-700">{c.before || '—'}</div></div>
                <div><div className="font-medium text-stone-500">now</div><div className="whitespace-pre-wrap text-stone-900">{c.after || '—'}</div></div>
              </div>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ChangesPanel() {
  const { review, update, me, setAmending } = useReview();
  const { manage, changes } = usePlanAccess();
  const [mode, setMode] = useState(null); // ack | restart
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const decided = mainDecisionCount(review);

  const done = () => { setMode(null); setReason(''); setConfirmText(''); setAmending(false); };
  const acknowledge = async () => { await update((r) => acknowledgeChanges(r, me, reason), { immediate: true }); done(); };
  const undo = async () => {
    if (!confirm('Undo every change listed here and go back to the plan as it was when the review started?')) return;
    await update((r) => revertChanges(r), { immediate: true });
    done();
  };
  const restart = async () => {
    setBusy(true); setErr(null);
    try {
      await api.backup(review.id);
      await update((r) => restartReview(r, me, reason), { immediate: true });
      done();
    } catch (e) { setErr(`Restart failed (${e.message}). Nothing was archived.`); } finally { setBusy(false); }
  };

  return (
    <Card className="border-l-4 border-l-rose-600 p-5">
      <div className="text-xs font-medium uppercase tracking-[0.15em] text-rose-700">screening is paused</div>
      <div className="mt-1 text-lg font-bold lowercase">{changes.length} change{changes.length === 1 ? '' : 's'} to the plan since the review started</div>
      <p className="mt-1 text-sm text-stone-600">
        Protocol, criteria, searches and method settings were frozen on {fmtDate(review.lock.startedAt)}. Until the lead reviewer resolves these changes, nobody can screen, code or appraise.
      </p>
      <ChangeList changes={changes} />
      {!manage && <p className="mt-4 text-sm text-stone-700">Waiting for the lead reviewer ({leadNames(review)}).</p>}
      {manage && !mode && (
        <div className="mt-5 flex flex-wrap gap-2">
          <Button tone="primary" onClick={() => setMode('ack')}>Acknowledge as amendment…</Button>
          <Button onClick={undo} disabled={!canRevert(review)} title={canRevert(review) ? 'Restore the plan as it was at the start' : 'Undo is not available for new or removed imports: remove the import on the searches page instead'}>Undo changes</Button>
          <Button tone="danger" onClick={() => setMode('restart')}>Restart from scratch…</Button>
        </div>
      )}
      {manage && mode === 'ack' && (
        <div className="mt-5 space-y-2">
          <div className="text-sm">
            The changes are recorded with your reason as a protocol amendment and become the new frozen plan. The {decided} decision{decided === 1 ? '' : 's'} made so far stay as they are; report the amendment in the paper (it is included in the paper data export).
          </div>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why was the plan changed? e.g. EC3 was ambiguous for conference abstracts; clarified after discussion on 14 Nov. Records already screened were re-checked against the new wording." autoFocus />
          <div className="flex gap-2">
            <Button tone="primary" disabled={reason.trim().length < 10} onClick={acknowledge}>Acknowledge &amp; resume screening</Button>
            <Button tone="ghost" onClick={() => setMode(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {manage && mode === 'restart' && (
        <div className="mt-5 space-y-2">
          <div className="bg-rose-50 p-3 text-sm text-rose-900">
            Every reviewer&apos;s screening, coding and appraisal ({decided} decision{decided === 1 ? '' : 's'}) and all consensus decisions are moved to an archive inside the review, and screening starts again under the current plan. Nothing is deleted, and a backup is taken first. Calibration rounds are kept.
          </div>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why does the review start again?" autoFocus />
          <label className="block text-sm">Type <b>restart</b> to confirm
            <input className="ml-2 w-32 border border-stone-300 px-2 py-1 text-sm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          </label>
          {err && <div className="text-sm text-rose-700">{err}</div>}
          <div className="flex gap-2">
            <Button tone="rose" disabled={busy || confirmText.trim().toLowerCase() !== 'restart' || reason.trim().length < 10} onClick={restart}>{busy ? 'Archiving…' : 'Archive everything & restart'}</Button>
            <Button tone="ghost" onClick={() => setMode(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---- gate around screening, coding, appraisal and consensus ------------------------------------------
// `beforeStart` replaces the default "not started" notice (title/abstract screening shows the StartChoice there).
export function WorkGate({ scope = 'screening', allowBeforeStart = false, beforeStart = null, children }) {
  const { review } = useReview();
  const block = workBlock(review, scope);
  if (!block || (block !== 'paused' && allowBeforeStart)) return children;
  if (block === 'paused') return <div className="mx-auto max-w-3xl px-8 py-10"><ChangesPanel /></div>;
  return beforeStart || <div className="mx-auto max-w-3xl px-8 py-10"><NotStarted /></div>;
}

function NotStarted() {
  return (
    <Card className="border-l-4 border-l-brand-yellow p-6">
      <div className="text-xs font-medium uppercase tracking-[0.15em] text-stone-500">not started yet</div>
      <div className="mt-1 text-2xl font-bold lowercase">the review has not been started</div>
      <p className="mt-2 text-sm text-stone-700">
        This step opens once the lead reviewer has started the full review in step 4 (title / abstract screening). An optional calibration round can run before that.
      </p>
      <Link to="../screen/ta" className="mt-5 inline-block"><Button tone="primary">Go to title / abstract screening</Button></Link>
    </Card>
  );
}

// ---- step 4 before the start: optional calibration round, or the full review --------------------------
function readiness(review, steps) {
  const step = (k) => steps.find((s) => s.key === k);
  const humans = review.reviewers.filter(isHuman).length;
  return [
    [step('protocol')?.done, 'Step 1 · protocol and criteria complete', step('protocol')?.detail],
    [step('searches')?.done, 'Step 2 · searches documented with imported results', step('searches')?.detail],
    [review.records.length > 0, 'Records imported', `${review.records.length} records`],
    [humans >= 2, 'At least two human reviewers', `${humans} human reviewer${humans === 1 ? '' : 's'}`],
  ];
}

function Checklist({ checks }) {
  return (
    <ul className="space-y-1 text-sm">
      {checks.map(([ok, label, detail]) => (
        <li key={label} className="flex gap-2">
          <span className={ok ? 'text-emerald-700' : 'text-amber-600'}>{ok ? '✓' : '!'}</span>
          <span><span className={ok ? '' : 'font-medium'}>{label}</span> <span className="text-xs text-stone-500">· {detail}</span></span>
        </li>
      ))}
    </ul>
  );
}

// Who has finished the calibration set: [{ rv, done, total }].
function calibrationProgress(review) {
  const set = calibrationSet(review, 'ta');
  return review.reviewers.map((rv) => {
    const mine = decisionsOf(review, rv.id).calibration?.ta || {};
    return { rv, done: set.filter((r) => mine[r.id]).length, total: set.length };
  }).filter((x) => x.done > 0 || isHuman(x.rv));
}

const FREEZE_WARNING = 'Starting the full review freezes the current state of step 1 (protocol & criteria) and step 2 (searches & import), together with the method settings (review type, framework, appraisal, deduplication). Any change after that pauses screening for every reviewer until the lead acknowledges it as a protocol amendment, undoes it, or restarts the review.';

export function StartChoice() {
  const { review, update, me } = useReview();
  const manage = canManage(review, me);
  const { steps } = useMemo(() => reviewStages(review), [review]);
  const checks = readiness(review, steps);
  const running = calibrationStarted(review);
  const streams = calibrationStreams(review);
  const [size, setSize] = useState(review.settings?.calibrationSize || 20);
  const [stream, setStream] = useState(streams.includes(review.settings?.calibrationStream) ? review.settings.calibrationStream : '');
  const [confirming, setConfirming] = useState(false);
  const [understood, setUnderstood] = useState(false);

  const poolSize = calibrationPool(review, 'ta', stream).length;
  const preview = Math.min(size, poolSize);
  const seeded = !running || !!review.calibration?.seed;
  const progress = calibrationProgress(review);
  const finished = progress.filter((p) => isHuman(p.rv) && p.total > 0 && p.done === p.total).length;
  const humans = progress.filter((p) => isHuman(p.rv)).length;
  const unique = uniqueRecords(review).length;
  const setChanged = size !== (review.settings?.calibrationSize || 20) || stream !== (review.settings?.calibrationStream || '');
  const saveSet = () => update((r) => changeCalibration(r, { size, stream }), { immediate: true });
  const leads = leadNames(review);

  const setInputs = manage && (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <Field label="Records in the calibration set" hint={`of ${unique} unique records; JBI suggests 25–50`}>
        <Input type="number" min={5} max={500} value={size} onChange={(e) => setSize(Math.max(1, Number(e.target.value) || 0))} />
      </Field>
      {streams.length > 0 && (
        <Field label="From search stream" hint="Calibrate on one stream, or on all records">
          <Select value={stream} onChange={(e) => setStream(e.target.value)}>
            <option value="">All streams</option>
            {streams.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
      )}
      <div className="text-xs text-stone-500 sm:col-span-2">
        {seeded
          ? <>A random sample of {preview} of the {poolSize} unique record{poolSize === 1 ? '' : 's'}{stream ? ` of stream ${stream}` : ''}, drawn once and the same for every reviewer. The draw is reproducible (its seed is stored) and later imports never change it.</>
          : <>This older calibration round uses the first {preview} record{preview === 1 ? '' : 's'}{stream ? ` of stream ${stream}` : ''} in screening order.</>}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <h1 className="brand-bar text-3xl font-bold lowercase tracking-tight">title / abstract screening: how do you want to begin?</h1>
      <p className="mt-4 max-w-3xl text-sm font-light text-stone-600">
        You can test the criteria with a calibration round first (optional), or start the full review straight away. {guide(review, 'pilotTip')}
      </p>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Optional calibration round */}
        <Card className="flex flex-col border-t-4 border-t-amber-500 p-6">
          <div className="flex items-center gap-2"><span className="text-xl font-bold lowercase">calibration round</span><Badge tone="unclear">optional</Badge></div>
          <p className="mt-2 text-sm text-stone-700">
            Every reviewer screens the same small set on their own. You then compare agreement per criterion under Compare &amp; consensus and sharpen the wording. Calibration decisions never count for PRISMA, and steps 1 and 2 stay editable.
          </p>
          {!running && setInputs}
          {!running && manage && <Button tone="amber" className="mt-5 self-start" disabled={!preview} onClick={() => update((r) => startCalibration(r, me, { size, stream }), { immediate: true })}>Start calibration round</Button>}
          {!running && !manage && <p className="mt-4 text-sm text-stone-600">The lead reviewer ({leads}) decides whether to run a calibration round.</p>}
          {running && (
            <>
              <div className="mt-4 text-sm">
                <b>Running</b>{review.calibration?.startedAt ? ` since ${fmtDate(review.calibration.startedAt)}` : ''}: {calibrationSummary(review)}.
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {progress.map(({ rv, done, total }) => (
                  <li key={rv.id} className="flex justify-between gap-3">
                    <span>{rv.name}{rv.type === 'llm' && <span className="ml-1 text-xs text-indigo-700">LLM</span>}{rv.id === me && <span className="ml-1 text-xs text-stone-500">(you)</span>}</span>
                    <span className={`tabular-nums ${done === total && total ? 'text-emerald-700' : 'text-stone-500'}`}>{done}/{total}{done === total && total ? ' ✓' : ''}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link to="?cal=1"><Button tone="amber">Go to the calibration round</Button></Link>
                <Link to="../compare?cal=1"><Button>Compare results</Button></Link>
              </div>
              {manage && (
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-stone-600 underline">Change the calibration set</summary>
                  {setInputs}
                  <p className="mt-2 text-xs text-stone-500">Changing the set changes it for every reviewer.{seeded ? ' It is redrawn with the same seed, so records already in the set stay in it as far as possible.' : ''} Decisions already made are kept.</p>
                  <Button size="sm" className="mt-2" disabled={!setChanged || !preview} onClick={saveSet}>Save calibration set</Button>
                </details>
              )}
            </>
          )}
        </Card>

        {/* Full review */}
        <Card className="flex flex-col border-t-4 border-t-black p-6">
          <div className="text-xl font-bold lowercase">full review</div>
          <p className="mt-2 text-sm text-stone-700">
            Every assigned reviewer screens all records (or their sample) independently. These decisions count for PRISMA and are compared under Compare &amp; consensus.
          </p>
          <div className="mt-4"><Checklist checks={[...checks, [running && finished === humans && humans > 0, 'Calibration round (optional)', running ? `${finished} of ${humans} human reviewers finished` : 'not run']]} /></div>
          <div className="mt-4 border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950"><b>This freezes steps 1 and 2.</b> {FREEZE_WARNING.replace(/^Starting the full review freezes /, 'It freezes ')}</div>
          {!manage && <p className="mt-4 text-sm text-stone-600">Only the lead reviewer ({leads}) can start the full review.</p>}
          {manage && !confirming && <Button tone="primary" className="mt-5 self-start" onClick={() => setConfirming(true)}>Start the full review…</Button>}
          {manage && confirming && (
            <div className="mt-5 bg-stone-100 p-4 text-sm">
              {checks.some(([ok]) => !ok) && <p className="mb-2 font-medium text-amber-800">Not everything above is ready. You can still start, but later changes to steps 1 and 2 will pause screening.</p>}
              {running && finished < humans && <p className="mb-2 font-medium text-amber-800">The calibration round is not finished by every reviewer. Its decisions are kept and can still be compared.</p>}
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
                <span>I understand that protocol, criteria, searches and imports are frozen from now on.</span>
              </label>
              <div className="mt-3 flex gap-2">
                <Button tone="primary" disabled={!understood} onClick={() => update((r) => startReview(r, me), { immediate: true })}>Freeze steps 1 and 2 and start</Button>
                <Button tone="ghost" onClick={() => { setConfirming(false); setUnderstood(false); }}>Cancel</Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---- overview: start card / status and amendment log -------------------------------------------------
export function StartCard() {
  const { review } = useReview();
  const { manage, started, changes } = usePlanAccess();
  const { steps } = useMemo(() => reviewStages(review), [review]);

  if (started) {
    const log = (review.lock.log || []).filter((e) => e.kind !== 'start');
    return (
      <Card className={`border-l-4 p-5 ${changes.length ? 'border-l-rose-600' : 'border-l-black'}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.15em] text-stone-500">{changes.length ? 'paused' : 'plan frozen'}</div>
            <div className="mt-1 text-sm">
              Started on <b>{fmtDate(review.lock.startedAt)}</b> by {nameOf(review, review.lock.startedBy)}.
              {' '}{log.length ? `${countOf(log, 'amendment', 'amendment')}${countOf(log, 'restart', 'restart')} recorded.`.replace(/^ · /, '') : 'No amendments.'}
            </div>
          </div>
          {changes.length > 0 && <Link to="protocol" className="text-sm text-rose-700 underline">{changes.length} unresolved change{changes.length === 1 ? '' : 's'} →</Link>}
        </div>
        {log.length > 0 && (
          <ol className="mt-3 space-y-2 border-t border-stone-100 pt-3 text-sm">
            {log.map((e, i) => (
              <li key={i}>
                <span className="font-medium">{e.kind === 'restart' ? 'Restarted' : 'Amendment'}</span> · {fmtDate(e.at)} · {nameOf(review, e.by)}
                {e.kind === 'restart' && ` · ${e.decisionsArchived} decisions archived`}
                <div className="text-stone-600">{e.reason}</div>
                {e.changes?.length > 0 && <div className="text-xs text-stone-500">{e.changes.map((c) => c.label).join(' · ')}</div>}
              </li>
            ))}
          </ol>
        )}
      </Card>
    );
  }

  const running = calibrationStarted(review);
  return (
    <Card className="border-l-4 border-l-brand-yellow p-6">
      <div className="text-xs font-medium uppercase tracking-[0.15em] text-stone-500">{running ? 'calibration round running' : 'not started'}</div>
      <div className="mt-1 text-2xl font-bold lowercase">{running ? 'calibration before the full review' : 'the review has not been started'}</div>
      <p className="mt-2 text-sm text-stone-700">
        In step 4 (title / abstract screening) the lead reviewer chooses whether to run an optional calibration round first, or to start the full review. {FREEZE_WARNING}
      </p>
      <div className="mt-4"><Checklist checks={readiness(review, steps)} /></div>
      {!manage && <p className="mt-4 text-sm text-stone-600">The lead reviewer ({leadNames(review)}) starts the review.</p>}
      <Link to="screen/ta" className="mt-5 inline-block"><Button tone="primary">{manage ? 'Choose how to begin →' : 'Go to step 4 →'}</Button></Link>
    </Card>
  );
}

// ---- sidebar status line -----------------------------------------------------------------------------
export function LockStatus() {
  const { review } = useReview();
  const changes = useMemo(() => planChanges(review), [review]);
  const [cls, text, to] = changes.length
    ? ['bg-rose-600 text-white', `paused · ${changes.length} change${changes.length === 1 ? '' : 's'} to resolve`, 'protocol']
    : isStarted(review)
      ? ['bg-black text-white', `started ${fmtDate(review.lock.startedAt)} · plan frozen`, '']
      : calibrationStarted(review)
        ? ['bg-amber-500 text-white', 'calibration round · plan open', 'screen/ta']
        : ['bg-brand-yellow text-white', 'not started · plan open', 'screen/ta'];
  return <Link to={to} className={`mx-4 mb-2 block px-3 py-1.5 text-[12px] lowercase ${cls}`}>{text}</Link>;
}
