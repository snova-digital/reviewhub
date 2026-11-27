// Comparison step: independent decisions side by side, inter-rater agreement, and consensus.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalibrationRounds } from '../components/PlanLock.jsx';
import { canManage } from '../lib/lock.js';
import { useReview } from '../lib/store.jsx';
import {
  codingPool, criteriaFor, criteriaHash, criterionApplies, criterionCode, criterionState, reasonCriteria, reasonLabel, DECISION_LABEL, DECISIONS, decisionsOf, finalCoding, finalDecision, groupCodes, isAssigned, isHuman, stagePool,
} from '../lib/model.js';
import { comparePair, compareCoding, fmtK, kappaBand, pct } from '../lib/agreement.js';
import { guide } from '../lib/methods.js';

// How an agent (LLM) reviewer arrived at its decision: rationale, confidence and per-criterion judgements with
// evidence, from the decision's `agent` block (written by scripts/rh.mjs or the CSV import). Flags decisions made
// under criteria that have changed since.
function AgentReasoning({ agent, stage }) {
  const { review } = useReview();
  const stale = agent.criteriaHash && agent.criteriaHash !== criteriaHash(review, stage);
  const tone = { yes: 'text-emerald-700', no: 'text-rose-700', unclear: 'text-amber-700' };
  return (
    <div className="space-y-1.5 border-l-2 border-indigo-300 pl-2 text-xs">
      <div className="flex flex-wrap gap-x-3 text-stone-500">
        <span className="font-medium text-indigo-800">Agent reasoning</span>
        {agent.confidence != null && <span>confidence {Math.round(agent.confidence * 100)}%</span>}
        {agent.runId && <span title="agent-logs/<reviewer>/<run>.jsonl in the review folder">run {agent.runId}</span>}
      </div>
      {stale && <div className="bg-amber-50 px-1.5 py-0.5 text-amber-900">Decided under earlier criteria (criteria changed since this run).</div>}
      {agent.rationale && <div className="text-stone-700">{agent.rationale}</div>}
      {(agent.criteria || []).length > 0 && (
        <ul className="space-y-0.5">
          {agent.criteria.map((c, i) => (
            <li key={i}><b className={tone[c.met] || 'text-stone-600'}>{c.code} {c.met}</b>{c.evidence ? <span className="italic text-stone-600"> “{c.evidence}”</span> : null}{c.location ? <span className="text-stone-400"> ({c.location})</span> : null}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
import { Badge, Button, Card, Empty, SectionTitle, Select, Stat, Textarea } from '../components/ui.jsx';

const STAGES = [['ta', 'Title / abstract'], ['ft', 'Full text'], ['coding', 'Extraction & coding']];
const LIST_FILTERS = {
  conflict: 'Conflicts to resolve (human reviewers disagree)',
  disagree: 'Any disagreement (incl. LLM reviewers)',
  compared: 'All records decided by ≥2 reviewers',
  resolved: 'Resolved by consensus',
  awaiting: 'Awaiting a second reviewer',
};

export default function ComparePage() {
  const { review, reload, status, update, me } = useReview();
  const [stage, setStage] = useState('ta');
  const [params] = useSearchParams();
  const [scope, setScope] = useState(params.get('cal') ? 'calibration' : 'screening');
  const isCoding = stage === 'coding';
  const sc = isCoding ? 'screening' : scope;

  // Each reviewer's map for this stage/scope: recordId → decision (or coding entry).
  const maps = useMemo(() => Object.fromEntries(review.reviewers.map((rv) => {
    const d = decisionsOf(review, rv.id);
    if (isCoding) return [rv.id, Object.fromEntries(Object.entries(d.coding || {}).filter(([, c]) => c.done))];
    return [rv.id, d[sc]?.[stage] || {}];
  })), [review, stage, sc, isCoding]);
  const active = review.reviewers.filter((rv) => Object.keys(maps[rv.id]).length);

  const humans = active.filter(isHuman);
  const [pa, setPa] = useState(null);
  const [pb, setPb] = useState(null);
  const A = active.find((x) => x.id === pa) || humans[0] || active[0];
  const B = active.find((x) => x.id === pb && x.id !== A?.id) || active.find((x) => x.id !== A?.id);

  const crit = useMemo(() => (isCoding ? [] : criteriaFor(review, stage)), [review, stage, isCoding]);
  const cats = isCoding ? [] : DECISIONS[stage].map((d) => d.value);
  const pair = useMemo(() => {
    if (!A || !B) return null;
    const recs = new Map(review.records.map((r) => [r.id, r]));
    return isCoding ? compareCoding(maps[A.id], maps[B.id], review.codebook)
      : comparePair(maps[A.id], maps[B.id], { criteria: crit, categories: cats, stateOf: criterionState, appliesTo: (c, id) => criterionApplies(review, c, recs.get(id)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [A, B, maps, crit, isCoding, review.codebook]);

  const pairs = useMemo(() => {
    const out = [];
    for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      const res = isCoding ? compareCoding(maps[a.id], maps[b.id], review.codebook) : comparePair(maps[a.id], maps[b.id], {});
      out.push({ a, b, n: res.shared.length, agree: isCoding ? res.exact : res.decision.agree, kappa: isCoding ? null : res.decision.kappa });
    }
    return out;
  }, [active, maps, isCoding, review.codebook]);

  // After revising the criteria: archive this stage's calibration decisions of every reviewer and start over.
  const startNewRound = () => {
    if (!confirm('Archive all calibration decisions for this stage and start a new calibration round? (Use after revising the criteria.)')) return;
    update((r) => {
      const decisions = { ...r.decisions };
      for (const rid of Object.keys(decisions)) {
        const d = decisions[rid];
        if (!Object.keys(d.calibration?.[stage] || {}).length) continue;
        decisions[rid] = {
          ...d,
          calibrationArchive: [...(d.calibrationArchive || []), { stage, archivedAt: new Date().toISOString(), decisions: d.calibration[stage] }],
          calibration: { ...d.calibration, [stage]: {} },
        };
      }
      return { ...r, decisions };
    }, { immediate: true });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-8 py-8">
      <SectionTitle
        title="Compare & consensus"
        hint="Decisions of independent reviewers side by side. Agreement is reported as percent agreement and Cohen's kappa. Human conflicts must be resolved by consensus; LLM reviewers are compared but never decide."
        actions={<Button onClick={reload} disabled={status === 'saving'} title="Load the latest decision files from disk (e.g. after your co-reviewer screened)">↻ Refresh decisions</Button>}
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-md text-sm ring-1 ring-stone-300">
          {STAGES.map(([k, l], i) => (
            <button key={k} onClick={() => setStage(k)} className={`px-3 py-1.5 ${i === 0 ? 'rounded-l-md' : i === STAGES.length - 1 ? 'rounded-r-md' : ''} ${stage === k ? 'bg-stone-800 text-white' : 'hover:bg-stone-100'}`}>{l}</button>
          ))}
        </div>
        {!isCoding && (
          <div className="flex rounded-md text-sm ring-1 ring-stone-300">
            <button onClick={() => setScope('screening')} className={`rounded-l-md px-3 py-1.5 ${scope === 'screening' ? 'bg-stone-800 text-white' : 'hover:bg-stone-100'}`}>Main screening</button>
            <button onClick={() => setScope('calibration')} className={`rounded-r-md px-3 py-1.5 ${scope === 'calibration' ? 'bg-amber-500 text-white' : 'hover:bg-stone-100'}`}>Calibration</button>
          </div>
        )}
        {/* Title/abstract: numbered rounds with fresh records (step 4). Full text: archive and screen the set again. */}
        {scope === 'calibration' && stage === 'ft' && canManage(review, me) && <Button size="sm" onClick={startNewRound}>Archive & start new calibration round</Button>}
      </div>
      {scope === 'calibration' && stage === 'ta' && <Card className="p-4"><CalibrationRounds /></Card>}

      {active.length < 2 ? (
        <Empty title="Nothing to compare yet">At least two reviewers need decisions in this stage{!isCoding && scope === 'calibration' ? ' (calibration round)' : ''}. Reviewers so far: {active.map((x) => x.name).join(', ') || 'none'}.</Empty>
      ) : (
        <>
          <section className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-stone-500">Compare</span>
              <div className="w-48"><Select value={A.id} onChange={(e) => setPa(e.target.value)}>{active.map((x) => <option key={x.id} value={x.id}>{x.name}{x.type === 'llm' ? ' (LLM)' : ''}</option>)}</Select></div>
              <span className="text-stone-500">with</span>
              <div className="w-48"><Select value={B?.id} onChange={(e) => setPb(e.target.value)}>{active.filter((x) => x.id !== A.id).map((x) => <option key={x.id} value={x.id}>{x.name}{x.type === 'llm' ? ' (LLM)' : ''}</option>)}</Select></div>
            </div>
            {pair && (isCoding ? <CodingStats pair={pair} A={A} B={B} /> : <ScreeningStats pair={pair} stage={stage} cats={cats} A={A} B={B} />)}
            {pairs.length > 1 && (
              <Card className="overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs text-stone-500"><tr><th className="px-4 py-2 font-medium">Reviewer pair</th><th className="font-medium">Records in common</th><th className="font-medium">{isCoding ? 'Identical code sets' : 'Agreement'}</th>{!isCoding && <th className="px-4 font-medium">Cohen's κ</th>}</tr></thead>
                  <tbody>{pairs.map((p) => (
                    <tr key={`${p.a.id}-${p.b.id}`} className="border-t border-stone-100"><td className="px-4 py-2">{p.a.name} × {p.b.name}</td><td className="tabular-nums">{p.n}</td><td className="tabular-nums">{pct(p.agree)}</td>{!isCoding && <td className="px-4 tabular-nums">{fmtK(p.kappa)} <span className="text-xs text-stone-400">{kappaBand(p.kappa)}</span></td>}</tr>
                  ))}</tbody>
                </table>
              </Card>
            )}
          </section>
          {isCoding
            ? <CodingRecords maps={maps} reviewers={active} />
            : <RecordList stage={stage} scope={scope} maps={maps} reviewers={active} crit={crit} />}
        </>
      )}
    </div>
  );
}

function ScreeningStats({ pair, stage, cats, A, B }) {
  const { review } = useReview();
  const k = pair.decision;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        <Stat label="Decided by both" value={pair.shared.length} />
        <Stat label="Percent agreement" value={pct(k.agree)} sub={guide(review, 'pilotTarget')} />
        <Stat label="Cohen's κ (decision)" value={fmtK(k.kappa)} sub={kappaBand(k.kappa)} />
        {stage === 'ta'
          ? <Stat label="κ exclude vs. forward" value={fmtK(pair.binary.kappa)} sub={`${pct(pair.binary.agree)} agree on what moves on`} />
          : <Stat label="κ exclude vs. not" value={fmtK(pair.binary.kappa)} sub={pct(pair.binary.agree)} />}
      </div>
      <div className="grid grid-cols-[auto_1fr] items-start gap-6">
        <Card className="p-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">Confusion matrix</div>
          <table className="text-sm">
            <thead><tr><th className="pr-3 text-left text-xs font-normal text-stone-400">{A.name} ↓ / {B.name} →</th>{cats.map((c) => <th key={c} className="px-2 text-xs font-medium">{DECISION_LABEL[c]}</th>)}</tr></thead>
            <tbody>{cats.map((ca, i) => (
              <tr key={ca}><td className="pr-3 text-xs font-medium">{DECISION_LABEL[ca]}</td>
                {cats.map((cb, j) => <td key={cb} className={`px-2 py-1 text-center tabular-nums ${i === j ? 'bg-emerald-50 font-semibold' : pair.matrix[i][j] ? 'bg-rose-50 text-rose-800' : 'text-stone-300'}`}>{pair.matrix[i][j]}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </Card>
        <Card className="overflow-hidden">
          <div className="px-4 pt-3 text-xs font-medium uppercase tracking-wide text-stone-500">Agreement per criterion (ticked vs. not; paired: meets / unclear / fails)</div>
          <table className="mt-1 w-full text-sm">
            <tbody>{pair.perCriterion.map((pc) => (
              <tr key={pc.criterion.id} className="border-t border-stone-100">
                <td className="max-w-md px-4 py-1.5"><b className="mr-1 text-stone-500">{criterionCode(review, pc.criterion.id)}</b><span className="line-clamp-1 inline">{pc.criterion.text}</span>{pc.criterion.kind === 'paired' && <span className="ml-1 text-[10px] uppercase text-stone-400">paired</span>}</td>
                {pc.used ? <>
                  <td className="w-16 tabular-nums">{pct(pc.agree)}</td>
                  <td className={`w-36 pr-4 tabular-nums ${pc.kappa != null && pc.kappa < 0.4 ? 'text-rose-700' : ''}`}>κ {fmtK(pc.kappa)} <span className="text-xs text-stone-400">{kappaBand(pc.kappa)}</span></td>
                </> : <td colSpan={2} className="pr-4 text-xs text-stone-400">not used by either</td>}
              </tr>
            ))}</tbody>
          </table>
          <div className="px-4 pb-3 pt-1 text-xs text-stone-400">Low κ (red) = criteria the reviewers interpret differently: candidates for clearer wording after calibration.</div>
        </Card>
      </div>
    </div>
  );
}

function CodingStats({ pair, A, B }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Coded by both" value={pair.shared.length} sub={`${A.name} × ${B.name}`} />
        <Stat label="Identical code sets" value={pct(pair.exact)} />
        <Stat label="Mean κ across used codes" value={fmtK(avg(pair.perCode.map((c) => c.kappa)))} />
      </div>
      <Card className="overflow-hidden">
        <div className="px-4 pt-3 text-xs font-medium uppercase tracking-wide text-stone-500">Agreement per code (applied vs. not applied)</div>
        <table className="mt-1 w-full text-sm"><tbody>
          {pair.perCode.map((pc) => (
            <tr key={pc.code.id} className="border-t border-stone-100">
              <td className="px-4 py-1.5"><span className="text-stone-400">{pc.code.group ? `${pc.code.group}: ` : ''}</span>{pc.code.label}</td>
              {pc.used ? <>
                <td className="w-16 tabular-nums">{pct(pc.agree)}</td>
                <td className={`w-36 pr-4 tabular-nums ${pc.kappa != null && pc.kappa < 0.4 ? 'text-rose-700' : ''}`}>κ {fmtK(pc.kappa)} <span className="text-xs text-stone-400">{kappaBand(pc.kappa)}</span></td>
              </> : <td colSpan={2} className="pr-4 text-xs text-stone-400">not applied by either</td>}
            </tr>
          ))}
        </tbody></table>
      </Card>
    </div>
  );
}
const avg = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

// ---- per-record comparison + consensus (screening stages) --------------------------
function RecordList({ stage, scope, maps, reviewers, crit }) {
  const { review } = useReview();
  const [filter, setFilter] = useState(scope === 'calibration' ? 'compared' : 'conflict');
  const [open, setOpen] = useState(null);
  const [limit, setLimit] = useState(50);
  const byId = useMemo(() => Object.fromEntries(review.records.map((r) => [r.id, r])), [review.records]);

  const rows = useMemo(() => {
    const ids = scope === 'calibration'
      ? [...new Set(reviewers.flatMap((rv) => Object.keys(maps[rv.id])))]
      : stagePool(review, stage).map((r) => r.id);
    return ids.filter((id) => byId[id]).map((id) => {
      const votes = reviewers.map((rv) => ({ rv, d: maps[rv.id][id] })).filter((v) => v.d);
      const disagree = new Set(votes.map((v) => v.d.decision)).size > 1;
      const fin = scope === 'screening' ? finalDecision(review, stage, id) : null;
      const awaiting = scope === 'screening' && votes.length >= 1 && review.reviewers.filter(isHuman)
        .some((rv) => isAssigned(rv, stage, id) && !maps[rv.id]?.[id]) && votes.filter((v) => isHuman(v.rv)).length < 2;
      return { id, rec: byId[id], votes, disagree, fin, awaiting };
    }).filter((x) => ({
      conflict: x.fin?.status === 'conflict',
      disagree: x.disagree,
      compared: x.votes.length >= 2,
      resolved: x.fin?.status === 'consensus',
      awaiting: x.awaiting,
    }[filter]));
  }, [review, stage, scope, maps, reviewers, byId, filter]);

  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <div className="w-96"><Select value={filter} onChange={(e) => { setFilter(e.target.value); setLimit(50); }}>
          {Object.entries(LIST_FILTERS).filter(([k]) => scope === 'screening' || ['disagree', 'compared'].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select></div>
        <span className="text-sm text-stone-500">{rows.length} records</span>
      </div>
      <Card className="divide-y divide-stone-100">
        {rows.length === 0 && <div className="p-5 text-sm text-stone-500">None.</div>}
        {rows.slice(0, limit).map((x) => (
          <div key={x.id}>
            <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-stone-50" onClick={() => setOpen(open === x.id ? null : x.id)}>
              <span className="line-clamp-1 flex-1">{x.rec.title}</span>
              {x.votes.map((v) => (
                <span key={v.rv.id} className="flex items-center gap-1 text-xs text-stone-500" title={v.rv.name}>
                  {v.rv.name}{v.rv.type === 'llm' ? ' (LLM)' : ''} <Badge tone={v.d.decision}>{DECISION_LABEL[v.d.decision]}</Badge>
                </span>
              ))}
              {x.fin && <span className="w-28 text-right"><FinalBadge fin={x.fin} /></span>}
            </button>
            {open === x.id && <RecordDetail x={x} stage={stage} scope={scope} crit={crit} />}
          </div>
        ))}
      </Card>
      {rows.length > limit && <div className="mt-3 text-center"><Button size="sm" onClick={() => setLimit(limit + 100)}>Show more</Button></div>}
    </section>
  );
}

function FinalBadge({ fin }) {
  if (fin.status === 'conflict') return <Badge tone="exclude">conflict</Badge>;
  if (fin.status === 'pending') return <Badge tone="pending">pending</Badge>;
  return <Badge tone={fin.decision}>{fin.status === 'consensus' ? '✓ consensus' : fin.status}</Badge>;
}

function RecordDetail({ x, stage, scope, crit }) {
  const { review, update, reviewer } = useReview();
  const existing = review.consensus?.[stage]?.[x.id];
  const [decision, setDecision] = useState(existing?.decision || '');
  const [reason, setReason] = useState(existing?.reason || '');
  const [note, setNote] = useState(existing?.note || '');
  const excl = reasonCriteria(review, stage);
  // A criterion differs when reviewers judged it differently (ticked vs. not, or meets / unclear / fails).
  const differs = (c) => new Set(x.votes.map((v) => criterionState(v.d, c) || '')).size > 1;

  const save = () => update((r) => ({
    ...r,
    consensus: {
      ...r.consensus,
      [stage]: {
        ...r.consensus[stage],
        [x.id]: {
          decision, reason: decision === 'exclude' ? reason || null : null, note,
          decidedBy: reviewer.name, decidedAt: new Date().toISOString(),
          votes: x.votes.map((v) => ({ reviewerId: v.rv.id, decision: v.d.decision })),
        },
      },
    },
  }));
  const reopen = () => update((r) => { const { [x.id]: _x, ...rest } = r.consensus[stage]; return { ...r, consensus: { ...r.consensus, [stage]: rest } }; });

  return (
    <div className="space-y-4 bg-stone-50/70 px-4 pb-5 pt-2 text-sm">
      {stage === 'ta' && <p className="max-w-5xl leading-relaxed text-stone-700">{x.rec.abstract || <i>No abstract.</i>}</p>}
      <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${x.votes.length}, minmax(0, 1fr))` }}>
        {x.votes.map((v) => {
          const ev = (review.decisions?.[v.rv.id]?.evidence?.[x.id] || []).filter((h) => h.stage !== 'coding');
          return (
            <Card key={v.rv.id} className="space-y-2 p-3">
              <div className="flex items-center justify-between"><b>{v.rv.name}{v.rv.type === 'llm' ? ' (LLM)' : ''}</b><Badge tone={v.d.decision}>{DECISION_LABEL[v.d.decision]}</Badge></div>
              <div className="flex flex-wrap gap-1">
                {crit.filter((c) => criterionState(v.d, c)).map((c) => {
                  const st = criterionState(v.d, c);
                  const tone = st === 'meets' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : st === 'unclear' ? 'bg-stone-100 text-stone-700 ring-stone-300' : 'bg-rose-50 text-rose-800 ring-rose-200';
                  return (
                    <span key={c.id} title={`${c.text}${c.kind === 'paired' ? ` (${st})` : ''}`} className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ${differs(c) ? 'bg-amber-100 text-amber-900 ring-amber-300' : tone}`}>
                      {criterionCode(review, c.id)}{c.kind === 'paired' && ` ${{ meets: '✓', unclear: '?', fails: '✗' }[st]}`}
                    </span>
                  );
                })}
                {!crit.some((c) => criterionState(v.d, c)) && <span className="text-xs text-stone-400">no criteria ticked</span>}
              </div>
              {v.d.reason && <div className="text-xs text-rose-800">Reason: {criterionCode(review, v.d.reason)}</div>}
              {v.d.note && <div className="text-xs italic text-stone-600">“{v.d.note}”</div>}
              {v.d.agent && <AgentReasoning agent={v.d.agent} stage={stage} />}
              {ev.map((h) => <div key={h.id} className="border-l-2 border-yellow-400 pl-2 text-xs italic text-stone-600">“{h.text}” {h.page ? `(p. ${h.page})` : ''} {h.criterionId ? `→ ${criterionCode(review, h.criterionId)}` : ''}</div>)}
            </Card>
          );
        })}
      </div>
      <div className="text-xs text-stone-400">Amber criteria were judged differently by the reviewers (✓ meets, ? unclear, ✗ fails for paired criteria).</div>
      {scope === 'screening' && (
        <Card className="space-y-3 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Consensus decision {existing && <span className="font-normal normal-case">: set by {existing.decidedBy} on {new Date(existing.decidedAt).toLocaleDateString()}</span>}</div>
          <div className="flex gap-1.5">
            {DECISIONS[stage].map((o) => (
              <button key={o.value} onClick={() => setDecision(o.value)} className={`rounded-md px-3 py-1.5 text-xs font-medium ring-1 ${decision === o.value ? 'bg-stone-800 text-white ring-stone-800' : 'ring-stone-300 hover:bg-stone-100'}`}>{o.label}</button>
            ))}
          </div>
          {decision === 'exclude' && (
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Primary exclusion reason…</option>
              {excl.map((c) => <option key={c.id} value={c.id}>{reasonLabel(review, c.id)}</option>)}
            </Select>
          )}
          <Textarea rows={2} placeholder="How the disagreement was resolved (discussion, third reviewer, clarified criterion…)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button tone="primary" disabled={!decision || (stage === 'ft' && decision === 'exclude' && !reason)} onClick={save}>{existing ? 'Update consensus' : 'Save consensus'}</Button>
            {existing && <Button tone="ghost" onClick={reopen}>Reopen</Button>}
          </div>
        </Card>
      )}
    </div>
  );
}

// ---- coding comparison + consensus ------------------------------------------------------
function CodingRecords({ maps, reviewers }) {
  const { review } = useReview();
  const [filter, setFilter] = useState('conflict');
  const [open, setOpen] = useState(null);
  const codeName = Object.fromEntries(review.codebook.map((c) => [c.id, c.label]));
  const rows = codingPool(review).map((rec) => {
    const votes = reviewers.map((rv) => ({ rv, c: maps[rv.id][rec.id] })).filter((v) => v.c);
    return { rec, votes, fin: finalCoding(review, rec.id) };
  }).filter((x) => ({ conflict: x.fin.status === 'conflict', compared: x.votes.length >= 2, resolved: x.fin.status === 'consensus' }[filter]));
  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <div className="w-80"><Select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="conflict">Code sets differ (to resolve)</option><option value="compared">All coded by ≥2 reviewers</option><option value="resolved">Resolved by consensus</option>
        </Select></div>
        <span className="text-sm text-stone-500">{rows.length} sources</span>
      </div>
      <Card className="divide-y divide-stone-100">
        {rows.length === 0 && <div className="p-5 text-sm text-stone-500">None.</div>}
        {rows.map((x) => (
          <div key={x.rec.id}>
            <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-stone-50" onClick={() => setOpen(open === x.rec.id ? null : x.rec.id)}>
              <span className="line-clamp-1 flex-1">{x.rec.title}</span>
              <span className="text-xs text-stone-500">{x.votes.map((v) => `${v.rv.name}: ${v.c.codes.length} codes`).join(' · ')}</span>
              <span className="w-28 text-right"><FinalBadge fin={{ ...x.fin, decision: 'include' }} /></span>
            </button>
            {open === x.rec.id && <CodingDetail x={x} codeName={codeName} />}
          </div>
        ))}
      </Card>
    </section>
  );
}

function CodingDetail({ x, codeName }) {
  const { review, update, reviewer } = useReview();
  const existing = review.consensus?.coding?.[x.rec.id];
  const union = [...new Set(x.votes.flatMap((v) => v.c.codes))];
  const [codes, setCodes] = useState(existing?.codes || x.votes.reduce((acc, v) => acc.filter((c) => v.c.codes.includes(c)), union));
  const [note, setNote] = useState(existing?.note || '');
  const inAll = (id) => x.votes.every((v) => v.c.codes.includes(id));
  const save = () => update((r) => ({ ...r, consensus: { ...r.consensus, coding: { ...(r.consensus.coding || {}), [x.rec.id]: { codes, note, decidedBy: reviewer.name, decidedAt: new Date().toISOString() } } } }));
  const reopen = () => update((r) => { const { [x.rec.id]: _x, ...rest } = r.consensus.coding; return { ...r, consensus: { ...r.consensus, coding: rest } }; });
  return (
    <div className="space-y-4 bg-stone-50/70 px-4 pb-5 pt-2 text-sm">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${x.votes.length}, minmax(0, 1fr))` }}>
        {x.votes.map((v) => (
          <Card key={v.rv.id} className="space-y-2 p-3">
            <b>{v.rv.name}</b>
            <div className="flex flex-wrap gap-1">{v.c.codes.map((id) => <span key={id} className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ${inAll(id) ? 'bg-indigo-50 ring-indigo-200' : 'bg-amber-100 ring-amber-300'}`}>{codeName[id] || '(deleted code)'}</span>)}</div>
            {v.c.note && <div className="text-xs italic text-stone-600">{v.c.note}</div>}
          </Card>
        ))}
      </div>
      <Card className="space-y-3 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Consensus codes (pre-selected: codes all coders applied)</div>
        {groupCodes(review.codebook).map(([g, list]) => (
          <div key={g}><div className="text-xs text-stone-500">{g}</div>
            <div className="mt-1 flex flex-wrap gap-1">{list.map((c) => {
              const on = codes.includes(c.id);
              return <button key={c.id} onClick={() => setCodes(on ? codes.filter((y) => y !== c.id) : [...codes, c.id])} className={`rounded-full px-2 py-0.5 text-xs ring-1 ${on ? 'bg-indigo-600 text-white ring-indigo-600' : union.includes(c.id) ? 'ring-amber-400' : 'text-stone-500 ring-stone-200'}`}>{c.label}</button>;
            })}</div>
          </div>
        ))}
        <Textarea rows={2} placeholder="Resolution note" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex gap-2"><Button tone="primary" onClick={save}>{existing ? 'Update consensus' : 'Save consensus'}</Button>{existing && <Button tone="ghost" onClick={reopen}>Reopen</Button>}</div>
      </Card>
    </div>
  );
}
