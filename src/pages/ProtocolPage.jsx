import { useReview } from '../lib/store.jsx';
import { Link } from 'react-router-dom';
import { criterionCode, newCriterion, STAGES } from '../lib/model.js';
import { criterionElements, FRAMEWORKS, frameworkElements, frameworkValues, guide, reviewSettings } from '../lib/methods.js';
import { Button, Card, Field, Input, SectionTitle, Select, Textarea } from '../components/ui.jsx';

// Static class names so Tailwind picks them up.
const ELEMENT_GRID = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-2 lg:grid-cols-4', 5: 'grid-cols-2 lg:grid-cols-5' };

export default function ProtocolPage() {
  const { review, update } = useReview();
  const p = review.protocol;
  const setP = (patch) => update((r) => ({ ...r, protocol: { ...r.protocol, ...patch } }));
  // Element values go to protocol.elements; PCC keys are mirrored into protocol.pcc for older exports and tools.
  const setElement = (k, v) => update((r) => ({
    ...r,
    protocol: {
      ...r.protocol,
      elements: { ...(r.protocol.elements || {}), [k]: v },
      ...(k in (r.protocol.pcc || {}) ? { pcc: { ...r.protocol.pcc, [k]: v } } : {}),
    },
  }));
  const settings = reviewSettings(review);
  const fw = FRAMEWORKS[settings.framework] || FRAMEWORKS.pcc;
  const elements = frameworkElements(review);
  const values = frameworkValues(review);
  const setTitle = (title) => update((r) => ({ ...r, title }));
  const screened = Object.values(review.decisions || {}).some((d) => Object.keys(d.screening?.ta || {}).length > 0);

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-8 py-8">
      <section>
        <SectionTitle
          title="Protocol"
          hint={guide(review, 'protocol')}
        />
        <Card className="space-y-4 p-5">
          <Field label="Review title"><Input value={review.title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Protocol registration / DOI" hint="e.g. OSF registration link">
              <Input value={p.registration} onChange={(e) => setP({ registration: e.target.value })} placeholder="https://osf.io/…" />
            </Field>
            <Field label="Reviewers" hint={guide(review, 'reviewersField')}>
              <div className="py-1.5 text-sm">{review.reviewers.map((r) => `${r.name}${r.type === 'llm' ? ' (LLM)' : ''}`).join(', ') || '—'}</div>
            </Field>
          </div>
          <Field label="Objective"><Textarea value={p.objective} onChange={(e) => setP({ objective: e.target.value })} /></Field>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-stone-500">Review questions</span>
            <div className="mt-1 space-y-2">
              {p.questions.map((q, i) => (
                <div key={i} className="flex gap-2">
                  <span className="mt-1.5 w-10 shrink-0 text-sm text-stone-400">{i + 1}.</span>
                  <Textarea rows={2} value={q} onChange={(e) => setP({ questions: p.questions.map((x, j) => (j === i ? e.target.value : x)) })} />
                  <Button tone="ghost" size="sm" onClick={() => setP({ questions: p.questions.filter((_, j) => j !== i) })}>✕</Button>
                </div>
              ))}
              <Button size="sm" onClick={() => setP({ questions: [...p.questions, ''] })}>+ Add question</Button>
            </div>
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle
          title="Eligibility framework"
          hint={<>{fw.label}. {fw.hint} <Link to="../settings" className="underline">Change the framework in the settings</Link>.</>}
        />
        {elements.length === 0 && <Card className="p-4 text-sm text-stone-500">No elements defined yet. Add your own elements under <Link to="../settings" className="underline">settings</Link>.</Card>}
        <div className={`grid gap-4 ${ELEMENT_GRID[Math.min(elements.length, 5)] || 'grid-cols-3'}`}>
          {elements.map(([k, label]) => (
            <Card key={k} className="p-4">
              <Field label={label}><Textarea rows={5} value={values[k] || ''} onChange={(e) => setElement(k, e.target.value)} /></Field>
            </Card>
          ))}
        </div>
        <Card className="mt-4 p-4">
          <Field label="Types of evidence sources" hint="e.g. peer-reviewed empirical studies, conference papers, grey literature, reviews…">
            <Textarea rows={2} value={p.evidenceSources} onChange={(e) => setP({ evidenceSources: e.target.value })} />
          </Field>
        </Card>
      </section>

      <section>
        <SectionTitle
          title="Eligibility criteria"
          hint="These become the checklist during screening. Mark at which stage each criterion can be judged; some (e.g. study design) often only at full text."
          actions={<>
            <Button size="sm" onClick={() => update((r) => ({ ...r, criteria: [...r.criteria, newCriterion('inclusion')] }))}>+ Inclusion</Button>
            <Button size="sm" onClick={() => update((r) => ({ ...r, criteria: [...r.criteria, newCriterion('exclusion')] }))}>+ Exclusion</Button>
          </>}
        />
        {screened && (
          <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
            Screening has started. {guide(review, 'deviation')} Deleting a criterion keeps past decisions but shows it as “deleted”.
          </div>
        )}
        {['inclusion', 'exclusion'].map((kind) => (
          <CriteriaList key={kind} kind={kind} />
        ))}
      </section>

      <section>
        <SectionTitle title="Screening aids" hint="Terms highlighted in titles, abstracts and keywords during title/abstract screening. Comma-separated; * wildcard allowed (e.g. tenan*)." />
        <Card className="grid grid-cols-2 gap-4 p-4">
          <Field label="Highlight green (relevant)">
            <Textarea rows={2} value={p.highlightTerms.include.join(', ')} onChange={(e) => setP({ highlightTerms: { ...p.highlightTerms, include: e.target.value.split(',').map((s) => s.trimStart()) } })} />
          </Field>
          <Field label="Highlight red (likely irrelevant)">
            <Textarea rows={2} value={p.highlightTerms.exclude.join(', ')} onChange={(e) => setP({ highlightTerms: { ...p.highlightTerms, exclude: e.target.value.split(',').map((s) => s.trimStart()) } })} />
          </Field>
        </Card>
        <Card className="mt-4 p-4">
          <Field label="Notes / deviations from protocol"><Textarea rows={4} value={p.notes} onChange={(e) => setP({ notes: e.target.value })} /></Field>
        </Card>
      </section>
    </div>
  );
}

function CriteriaList({ kind }) {
  const { review, update } = useReview();
  const list = review.criteria.filter((c) => c.kind === kind);
  const set = (id, patch) => update((r) => ({ ...r, criteria: r.criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const remove = (id) => {
    if (confirm('Delete this criterion?')) update((r) => ({ ...r, criteria: r.criteria.filter((c) => c.id !== id) }));
  };
  const move = (id, dir) => update((r) => {
    const arr = [...r.criteria];
    const i = arr.findIndex((c) => c.id === id);
    let j = i + dir;
    while (j >= 0 && j < arr.length && arr[j].kind !== kind) j += dir;
    if (j < 0 || j >= arr.length) return r;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return { ...r, criteria: arr };
  });
  const tone = kind === 'inclusion' ? 'text-emerald-700' : 'text-rose-700';
  return (
    <div className="mb-5">
      <h3 className={`mb-2 text-sm font-semibold capitalize ${tone}`}>{kind} criteria</h3>
      {list.length === 0 && <div className="text-sm text-stone-400">None yet.</div>}
      <div className="space-y-2">
        {list.map((c) => (
          <Card key={c.id} className="flex items-start gap-3 p-3">
            <span className={`mt-1.5 w-12 text-sm font-semibold ${tone}`}>{criterionCode(review, c.id)}</span>
            <div className="flex-1 space-y-2">
              <Textarea rows={2} value={c.text} onChange={(e) => set(c.id, { text: e.target.value })} placeholder="Criterion wording…" />
              <div className="flex items-center gap-4 text-sm">
                <div className="w-20"><Input value={c.code || ''} placeholder="Code" title="Custom code, e.g. IC1, RQ2, E3" onChange={(e) => set(c.id, { code: e.target.value.trim() })} /></div>
                {kind === 'inclusion' && (
                  <div className="w-36"><Input value={c.group || ''} placeholder="Group (≥1 of)" title="Criteria sharing a group: at least one must be met (e.g. RQ streams)" onChange={(e) => set(c.id, { group: e.target.value.trim() })} /></div>
                )}
                <div className="w-56"><Select value={c.element || ''} onChange={(e) => set(c.id, { element: e.target.value })}
                  className={c.element ? '' : 'text-stone-400'} title="Which part of the eligibility framework this criterion belongs to">
                  {!c.element && <option value="" disabled>Choose element…</option>}
                  {criterionElements(review).map((el) => <option key={el.value} value={el.value} className="text-black">{el.label}</option>)}
                  {c.element && !criterionElements(review).some((el) => el.value === c.element) && <option value={c.element}>{c.element}</option>}
                </Select></div>
                {Object.values(STAGES).map((s) => (
                  <label key={s.key} className="flex items-center gap-1.5 text-stone-600">
                    <input
                      type="checkbox"
                      checked={c.stages.includes(s.key)}
                      onChange={(e) => set(c.id, { stages: e.target.checked ? [...c.stages, s.key] : c.stages.filter((x) => x !== s.key) })}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Button tone="ghost" size="sm" onClick={() => move(c.id, -1)}>↑</Button>
              <Button tone="ghost" size="sm" onClick={() => move(c.id, 1)}>↓</Button>
              <Button tone="ghost" size="sm" onClick={() => remove(c.id)}>✕</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
