import { useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { Link, useSearchParams } from 'react-router-dom';
import { useReview } from '../lib/store.jsx';
import {
  ASSIGNMENT_MODES, assignmentLabel, criteriaFor, criteriaHash, criterionCode, decisionsOf, emptyDecisions, isAssigned, newReviewer, stagePool, workStagesFor,
} from '../lib/model.js';
import { guide, reviewSettings } from '../lib/methods.js';
import { Badge, Button, Card, Field, Input, SectionTitle, Select } from '../components/ui.jsx';
import { canManage, leadsOf, workBlock } from '../lib/lock.js';

function download(name, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);

const countDone = (d) => ({
  ta: Object.keys(d.screening?.ta || {}).length,
  ft: Object.keys(d.screening?.ft || {}).length,
  coding: Object.values(d.coding || {}).filter((c) => c.done).length,
  appraisal: Object.values(d.appraisal || {}).filter((c) => c.done).length,
});

function TypeBadge({ rv }) {
  return rv.type === 'llm'
    ? <Badge tone="info">LLM{rv.model ? ` · ${rv.model}` : ''}</Badge>
    : <><Badge tone="include">human</Badge>{rv.lead && <Badge tone="unclear">lead</Badge>}</>;
}

// ---- reviewer form (create + edit) -------------------------------------------
function ReviewerForm({ initial, onSubmit, submitLabel, onCancel, canSetLead = false }) {
  const [rv, setRv] = useState(initial);
  const { review } = useReview();
  const setA = (stage, patch) => setRv((x) => ({ ...x, assignment: { ...x.assignment, [stage]: { ...x.assignment[stage], ...patch } } }));
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (rv.name.trim()) onSubmit({ ...rv, name: rv.name.trim() }); }}>
      <div className="grid grid-cols-[1fr_auto] gap-4">
        <Field label="Name"><Input value={rv.name} onChange={(e) => setRv({ ...rv, name: e.target.value })} placeholder="e.g. Reviewer A, or Claude screener" autoFocus /></Field>
        <Field label="Reviewer type">
          <div className="flex rounded-md text-sm ring-1 ring-stone-300">
            {[['human', 'Human'], ['llm', 'LLM-based']].map(([v, l], i) => (
              <button key={v} type="button" onClick={() => setRv({ ...rv, type: v })}
                className={`px-4 py-1.5 ${i ? 'rounded-r-md' : 'rounded-l-md'} ${rv.type === v ? 'bg-stone-800 text-white' : 'hover:bg-stone-100'}`}>{l}</button>
            ))}
          </div>
        </Field>
      </div>
      {rv.type === 'human' && canSetLead && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={!!rv.lead} onChange={(e) => setRv({ ...rv, lead: e.target.checked })} />
          <span><b>Lead reviewer</b><span className="block text-xs text-stone-500">Can change protocol, criteria, searches, records, settings and reviewers, and starts the review. Everyone else sees these read-only.</span></span>
        </label>
      )}
      {rv.type === 'llm' && (
        <Field label="Model / setup" hint="Record model, version and prompt variant for reproducibility. LLM decisions are compared with human ones but never become final.">
          <Input value={rv.model} onChange={(e) => setRv({ ...rv, model: e.target.value })} placeholder="e.g. claude-opus-5-5, prompt v2, temperature 0" />
        </Field>
      )}
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-stone-500">Workload per stage</div>
        <div className="mt-1 space-y-2">
          {workStagesFor(review).map((st) => {
            const a = rv.assignment[st.key] || { mode: 'full', percent: 20 };
            const pool = stagePool(review, st.key);
            const n = pool.filter((r) => isAssigned(rv, st.key, r.id)).length;
            return (
              <div key={st.key} className="flex items-center gap-3 text-sm">
                <span className="w-36 text-stone-600">{st.label}</span>
                <div className="w-64"><Select value={a.mode} onChange={(e) => setA(st.key, { mode: e.target.value })}>
                  {ASSIGNMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </Select></div>
                {a.mode === 'sample' && (
                  <div className="flex items-center gap-1"><Input className="w-16" type="number" min={1} max={100} value={a.percent} onChange={(e) => setA(st.key, { percent: Number(e.target.value) })} />%</div>
                )}
                <span className="text-xs text-stone-400">{a.mode === 'none' ? '' : `currently ${n} of ${pool.length} records`}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-stone-400">
          A random cross-check draws a fixed, reproducible sample (hash of reviewer and record), so it stays the same as new records arrive.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" tone="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" tone="primary" disabled={!rv.name.trim()}>{submitLabel}</Button>
      </div>
    </form>
  );
}

// ---- first screen: who is reviewing? --------------------------------------------
export function ReviewerGate() {
  const { review, update, setMe } = useReview();
  const [params, setParams] = useSearchParams();
  // "Start as new reviewer" on the start page opens the form straight away.
  const [creating, setCreating] = useState(!review.reviewers?.length || params.get('reviewer') === 'new');
  const done = (rid) => { setMe(rid); if (params.has('reviewer')) setParams({}, { replace: true }); };
  // The first human reviewer of a review becomes its lead (can be changed under Reviewers).
  const create = (rv) => {
    const first = rv.type === 'human' && !leadsOf(review).length && !(review.reviewers || []).some((x) => x.type !== 'llm');
    const next = first ? { ...rv, lead: true } : rv;
    update((r) => ({ ...r, reviewers: [...(r.reviewers || []), next] }), { immediate: true });
    done(next.id);
  };
  return (
    <div className="mx-auto max-w-3xl px-8 py-14">
      <h1 className="brand-bar text-3xl font-bold tracking-tight">Who is reviewing?</h1>
      <p className="mt-4 text-sm font-light text-stone-600">
        Each reviewer screens independently: you only see your own decisions while screening. Decisions are compared afterwards in
        <b> Compare &amp; consensus</b>. Your choice is remembered in this browser; to review as someone else later, pick the reviewer on the start page.
      </p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {(review.reviewers || []).map((rv) => {
          const n = countDone(decisionsOf(review, rv.id));
          return (
            <button key={rv.id} onClick={() => done(rv.id)} className="rounded-lg border border-stone-200 bg-white p-4 text-left transition hover:border-indigo-400 hover:shadow">
              <div className="flex items-center justify-between"><span className="text-lg font-medium">{rv.name}</span><TypeBadge rv={rv} /></div>
              <div className="mt-2 text-xs text-stone-500">
                {workStagesFor(review).map((s) => `${s.label}: ${assignmentLabel(rv, s.key)}`).join(' · ')}
              </div>
              <div className="mt-1 text-xs text-stone-400">{n.ta} T/A · {n.ft} full text · {n.coding} coded</div>
            </button>
          );
        })}
        {!creating && (
          <button onClick={() => setCreating(true)} className="rounded-lg border border-dashed border-stone-300 p-4 text-left text-stone-600 hover:border-indigo-400 hover:text-indigo-700">
            <div className="text-lg">+ New reviewer</div>
            <div className="mt-1 text-xs">Human or LLM-based</div>
          </button>
        )}
      </div>
      {creating && (
        <Card className="mt-6 p-5">
          <div className="mb-4 font-medium">New reviewer</div>
          <ReviewerForm initial={newReviewer({ name: '' })} submitLabel="Create & continue" onSubmit={create}
            onCancel={review.reviewers?.length ? () => setCreating(false) : null} />
        </Card>
      )}
    </div>
  );
}

// ---- management page ------------------------------------------------------------
export default function ReviewersPage() {
  const { review, update, me, setMe } = useReview();
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef();

  const manage = canManage(review, me);
  const hadLead = leadsOf(review).length > 0;
  // Once a review has a lead it keeps at least one, otherwise everybody could edit again.
  const keepsLead = (list) => !hadLead || list.some((x) => x.lead && x.type !== 'llm');
  const save = (rv) => {
    const next = review.reviewers.map((x) => (x.id === rv.id ? (rv.type === 'llm' ? { ...rv, lead: false } : rv) : x));
    if (!keepsLead(next)) return alert('A review needs at least one lead reviewer. Make someone else lead first.');
    update((r) => ({ ...r, reviewers: r.reviewers.map((x) => (x.id === rv.id ? next.find((y) => y.id === rv.id) : x)) }));
    setEditing(null);
  };
  const add = (rv) => { update((r) => ({ ...r, reviewers: [...r.reviewers, rv] })); setAdding(false); };
  const remove = (rv) => {
    if (!keepsLead(review.reviewers.filter((x) => x.id !== rv.id))) return alert(`${rv.name} is the only lead reviewer. Make someone else lead first.`);
    const n = countDone(decisionsOf(review, rv.id));
    if (!confirm(`Remove reviewer "${rv.name}"? Their file (${n.ta} T/A, ${n.ft} full-text decisions, ${n.coding} coded) is moved to the workspace trash.`)) return;
    update((r) => {
      const { [rv.id]: _x, ...decisions } = r.decisions;
      return { ...r, reviewers: r.reviewers.filter((x) => x.id !== rv.id), decisions };
    }, { immediate: true });
    if (rv.id === me) setMe(null);
  };

  const exportReviewer = (rv) => download(`${slug(review.title)}-reviewer-${slug(rv.name)}.json`,
    JSON.stringify({ format: 'reviewhub-reviewer', reviewId: review.id, reviewer: rv, decisions: decisionsOf(review, rv.id) }, null, 2), 'application/json');

  async function importReviewer(e) {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.format !== 'reviewhub-reviewer') throw new Error('not a ReviewHub reviewer file');
      const exists = review.reviewers.find((x) => x.id === data.reviewer.id);
      if (exists && !confirm(`Replace all decisions of "${exists.name}" with the imported file?`)) return;
      update((r) => ({
        ...r,
        reviewers: exists ? r.reviewers.map((x) => (x.id === data.reviewer.id ? data.reviewer : x)) : [...r.reviewers, data.reviewer],
        decisions: { ...r.decisions, [data.reviewer.id]: { ...data.decisions, reviewerId: data.reviewer.id, rev: r.decisions[data.reviewer.id]?.rev || 0 } },
      }), { immediate: true });
      setMsg(`Imported reviewer "${data.reviewer.name}".`);
    } catch (err) { setMsg(`Import failed: ${err.message}`); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-8 py-8">
      <section>
        <SectionTitle
          title="Reviewers"
          hint={`${guide(review, 'reviewers')} Each reviewer has their own decision file (reviews/<id>/decisions/ in the workspace), so two people never overwrite each other. A reviewer can screen everything or cross-check a random sample. The lead reviewer manages protocol, criteria, searches, records, settings and this list; everyone else sees them read-only. Agent reviewers (e.g. Claude Code running in this folder) work the same way; see CLAUDE.md.`}
          actions={manage && <>
            <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={importReviewer} />
            <Button onClick={() => fileRef.current.click()}>Import reviewer file…</Button>
            <Button tone="primary" onClick={() => setAdding(true)}>+ Reviewer</Button>
          </>}
        />
        {msg && <div className="mb-3 rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-900">{msg}</div>}
        {!manage && <div className="mb-4 border-l-4 border-stone-400 bg-stone-100 px-4 py-3 text-sm text-stone-700"><b>Read-only.</b> Only the lead reviewer ({leadsOf(review).map((x) => x.name).join(', ')}) can add, change or remove reviewers.</div>}
        {manage && !hadLead && <div className="mb-4 border-l-4 border-brand-yellow bg-amber-50 px-4 py-3 text-sm">No lead reviewer is set, so every human reviewer can change the plan. Edit a reviewer and tick <b>Lead reviewer</b>.</div>}
        {adding && <Card className="mb-4 p-5"><ReviewerForm initial={newReviewer({ name: '' })} submitLabel="Add reviewer" onSubmit={add} onCancel={() => setAdding(false)} canSetLead={manage} /></Card>}
        <div className="space-y-3">
          {review.reviewers.map((rv) => {
            const n = countDone(decisionsOf(review, rv.id));
            if (editing === rv.id) return <Card key={rv.id} className="p-5"><ReviewerForm initial={rv} submitLabel="Save" onSubmit={save} onCancel={() => setEditing(null)} canSetLead={manage} /></Card>;
            return (
              <Card key={rv.id} className="flex items-center gap-4 p-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2"><span className="font-medium">{rv.name}</span><TypeBadge rv={rv} />{rv.id === me && <Badge tone="pending">you</Badge>}</div>
                  <div className="mt-1 text-xs text-stone-500">{workStagesFor(review).map((s) => `${s.label}: ${assignmentLabel(rv, s.key)}`).join(' · ')}</div>
                  <div className="text-xs text-stone-400">{n.ta} T/A · {n.ft} full text · {n.coding} coded</div>
                </div>
                {manage && <Button size="sm" onClick={() => setEditing(rv.id)}>Edit</Button>}
                <Button size="sm" onClick={() => exportReviewer(rv)} title="Download this reviewer's file, e.g. to send it to a co-reviewer working on another computer">Export</Button>
                {manage && <Button size="sm" tone="danger" onClick={() => remove(rv)}>Remove</Button>}
              </Card>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-stone-500">
          Working on separate computers: each person exports their reviewer file and the other imports it here. Records and protocol must come from the same review.
        </p>
      </section>

      {manage && <LlmTools />}

      <section>
        <SectionTitle title="Calibration round" hint={`Optional practice round before the full review: every reviewer screens the same small set separately from the main screening, then you compare agreement per criterion to sharpen the wording (${guide(review, 'pilotTarget')}).`} />
        <Card className="p-4 text-sm">
          The lead reviewer sets up and starts the calibration round (number of records{reviewSettings(review).streams ? ', search stream' : ''}) in step 4, <Link to="../screen/ta" className="underline">title / abstract screening</Link>.
        </Card>
      </section>
    </div>
  );
}

// ---- LLM reviewer: export a task pack, import decisions ----------------------------
const DECISION_ALIASES = {
  include: 'include', yes: 'include', in: 'include',
  exclude: 'exclude', no: 'exclude', out: 'exclude',
  unclear: 'unclear', maybe: 'unclear', fulltext: 'unclear', 'full text': 'unclear', 'review with full text': 'unclear',
  not_retrieved: 'not_retrieved',
};

function LlmTools() {
  const { review, update } = useReview();
  const llms = review.reviewers.filter((r) => r.type === 'llm');
  const [rid, setRid] = useState('');
  const [stage, setStage] = useState('ta');
  const [scope, setScope] = useState('screening');
  const [msg, setMsg] = useState(null);
  const fileRef = useRef();
  const target = llms.find((x) => x.id === rid) || llms[0];

  const codeToId = useMemo(() => Object.fromEntries(review.criteria.map((c) => [criterionCode(review, c.id).toLowerCase(), c.id])), [review]);

  if (!llms.length) return null;

  const exportPack = () => {
    const pool = stagePool(review, stage).filter((r) => isAssigned(target, stage, r.id));
    download(`${slug(review.title)}-llm-${stage}-records.csv`, Papa.unparse(pool.map((r) => ({
      record_id: r.id, title: r.title, abstract: r.abstract, keywords: r.keywords.join('; '), year: r.year, journal: r.journal, doi: r.doi,
    }))), 'text/csv');
    const crit = criteriaFor(review, stage);
    download(`${slug(review.title)}-llm-${stage}-criteria.md`, [
      `# ${review.title}: eligibility criteria (${stage === 'ta' ? 'title/abstract' : 'full text'})`, '',
      '## Review questions', ...review.protocol.questions.map((q) => `- ${q}`), '',
      ...(crit.some((c) => c.kind === 'paired') ? ['## Eligibility criteria (judge each: meets / unclear / fails)',
        ...crit.filter((c) => c.kind === 'paired').map((c) => `- **${criterionCode(review, c.id)}** Include: ${c.text}${c.excludeText ? ` | Exclude: ${c.excludeText}` : ''}`), ''] : []),
      '## Inclusion criteria', ...crit.filter((c) => c.kind === 'inclusion').map((c) => `- **${criterionCode(review, c.id)}** ${c.text}`), '',
      '## Exclusion criteria', ...crit.filter((c) => c.kind === 'exclusion').map((c) => `- **${criterionCode(review, c.id)}** ${c.text}`), '',
      '## Expected output (CSV)',
      'record_id, decision (include | exclude | fulltext), criteria (space-separated codes that apply; for eligibility criteria CODE=meets|unclear|fails), reason (code of the primary exclusion criterion), confidence (0–1), rationale (one or two sentences: how you arrived at the decision), note',
      '', `Criteria fingerprint: ${criteriaHash(review, stage)} (decisions are flagged if the criteria change afterwards).`,
    ].join('\n'), 'text/markdown');
  };

  async function importCsv(e) {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const block = workBlock(review, scope);
    if (block) return setMsg({
      paused: 'Screening is paused until the lead resolves the changes to the plan.',
      'not-started': 'The full review has not been started yet: only calibration decisions can be imported.',
      'calibration-not-started': 'No calibration round has been started yet (step 4).',
    }[block]);
    const { data } = Papa.parse(await f.text(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
    const byId = new Map(review.records.map((r) => [r.id, r]));
    const byDoi = new Map(review.records.filter((r) => r.doi).map((r) => [r.doi.toLowerCase(), r]));
    const decided = {}; const skipped = [];
    for (const row of data) {
      const rec = byId.get(row.record_id) || byDoi.get((row.doi || '').toLowerCase());
      const decision = DECISION_ALIASES[(row.decision || '').trim().toLowerCase()];
      if (!rec || !decision) { skipped.push(row.record_id || row.doi || '?'); continue; }
      // Plain codes are ticked; CODE=meets|unclear|fails sets a paired criterion (a bare paired code = meets).
      const marks = {}; const codes = [];
      for (const tok of (row.criteria || '').split(/[\s,;]+/).filter(Boolean)) {
        const [code, st] = tok.split('=');
        const c = review.criteria.find((x) => x.id === codeToId[code.toLowerCase()]);
        if (!c) continue;
        if (c.kind === 'paired') {
          const state = ['meets', 'unclear', 'fails'].includes((st || 'meets').toLowerCase()) ? (st || 'meets').toLowerCase() : null;
          if (state) marks[c.id] = state;
          if (state === 'meets') codes.push(c.id);
        } else codes.push(c.id);
      }
      const confidence = row.confidence === undefined || row.confidence === '' ? null : Number(row.confidence);
      decided[rec.id] = {
        decision, checked: codes, ...(Object.keys(marks).length ? { marks } : {}), reason: decision === 'exclude' ? codeToId[(row.reason || '').trim().toLowerCase()] || null : null,
        note: row.note || '', reviewer: target.name, decidedAt: new Date().toISOString(), history: [], importedFrom: f.name,
        agent: { source: 'csv', criteriaHash: criteriaHash(review, stage), confidence: Number.isFinite(confidence) ? confidence : null, rationale: row.rationale || '', criteria: [] },
      };
    }
    update((r) => {
      const d = r.decisions[target.id] || emptyDecisions(target.id);
      return { ...r, decisions: { ...r.decisions, [target.id]: { ...d, [scope]: { ...d[scope], [stage]: { ...d[scope][stage], ...decided } } } } };
    }, { immediate: true });
    setMsg(`Imported ${Object.keys(decided).length} decisions for ${target.name}.${skipped.length ? ` Skipped ${skipped.length} rows (unknown record or decision).` : ''}`);
  }

  return (
    <section>
      <SectionTitle title="LLM / agent reviewers" hint="Two ways to add an agent reviewer. (1) Recommended: run Claude Code (or another coding agent) in this folder; it reads CLAUDE.md and screens with the command-line helper scripts/rh.mjs, writing a full reasoning log per decision. (2) Any other model: export the records and criteria below, let the model decide, and import its CSV. Decisions show the agent's rationale under Compare & consensus." />
      <Card className="space-y-3 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-56"><Select value={target.id} onChange={(e) => setRid(e.target.value)}>{llms.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></div>
          <div className="w-44"><Select value={stage} onChange={(e) => setStage(e.target.value)}><option value="ta">Title / abstract</option><option value="ft">Full text</option></Select></div>
          <div className="w-44"><Select value={scope} onChange={(e) => setScope(e.target.value)}><option value="screening">Main screening</option><option value="calibration">Calibration</option></Select></div>
        </div>
        <div className="flex gap-2">
          <Button onClick={exportPack}>Export records + criteria</Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={importCsv} />
          <Button onClick={() => fileRef.current.click()}>Import decisions CSV…</Button>
        </div>
        <div className="text-xs text-stone-500">CSV columns: <code>record_id</code> (or <code>doi</code>), <code>decision</code> (include / exclude / fulltext), <code>criteria</code>, <code>reason</code>, <code>confidence</code>, <code>rationale</code>, <code>note</code>.</div>
        {msg && <div className="rounded bg-indigo-50 px-3 py-2 text-indigo-900">{msg}</div>}
      </Card>
    </section>
  );
}
