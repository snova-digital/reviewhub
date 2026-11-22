// Per-review settings: method profile, eligibility framework, deduplication and optional features.
// Every setting has a default in reviewSettings() (methods.js), so older reviews work without migration.
import { useMemo, useState } from 'react';
import { useReview } from '../lib/store.jsx';
import { recomputeDuplicates } from '../lib/dedup.js';
import { DEDUP_MODES, FRAMEWORKS, PROFILES, REVIEW_TYPES, reviewSettings } from '../lib/methods.js';
import { Button, Card, Field, Input, SectionTitle, Select } from '../components/ui.jsx';
import WorkspaceEditor from '../components/WorkspaceEditor.jsx';

const keyOf = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'element';

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="text-sm font-medium">{label}</span>{hint && <span className="mt-0.5 block text-xs text-stone-500">{hint}</span>}</span>
    </label>
  );
}

export default function SettingsPage() {
  const { review, update } = useReview();
  const s = reviewSettings(review);
  const setS = (patch) => update((r) => ({ ...r, settings: { ...reviewSettings(r), ...(r.settings || {}), ...patch } }));
  const [dedupMsg, setDedupMsg] = useState(null);

  // Dry run of re-deduplication with the chosen mode, so the effect is visible before applying it.
  const dedupPreview = useMemo(() => {
    const next = recomputeDuplicates(review.records, s.dedup);
    const before = review.records.filter((r) => r.duplicateOf).length;
    const after = next.filter((r) => r.duplicateOf).length;
    const changed = next.filter((r, i) => (r.duplicateOf || null) !== (review.records[i].duplicateOf || null)).length;
    return { before, after, changed };
  }, [review.records, s.dedup]);

  const applyDedup = () => {
    if (!confirm(`Re-run deduplication (${s.dedup}) on all ${review.records.length} records? ${dedupPreview.changed} records change status. Manual "not a duplicate" overrides are kept. Screening decisions are not deleted, but records flagged as duplicates leave the screening pool.`)) return;
    update((r) => ({ ...r, records: recomputeDuplicates(r.records, reviewSettings(r).dedup) }), { immediate: true });
    setDedupMsg(`Done: ${dedupPreview.after} duplicates flagged (before: ${dedupPreview.before}).`);
  };

  const custom = s.customElements || [];
  const setCustom = (list) => setS({ customElements: list });

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-8 py-8">
      <section>
        <SectionTitle title="Method" hint="The review type sets the methodology the app follows: guidance texts, the default eligibility framework, the reporting guideline and which steps are on by default. Changing it never deletes data." />
        <Card className="space-y-5 p-5">
          <Field label="Review type" hint={`${PROFILES[review.type || 'scoping'].methodology} · reported with ${PROFILES[review.type || 'scoping'].guideline}`}>
            <Select value={review.type || 'scoping'} onChange={(e) => update((r) => ({ ...r, type: e.target.value }))}>
              {REVIEW_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Eligibility framework" hint={FRAMEWORKS[s.framework]?.hint}>
            <Select value={s.framework} onChange={(e) => setS({ framework: e.target.value })}>
              {Object.entries(FRAMEWORKS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
            </Select>
          </Field>
          {s.framework === 'custom' && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-stone-500">Custom elements</div>
              <div className="mt-1 space-y-2">
                {custom.map((el, i) => (
                  <div key={el.key} className="flex gap-2">
                    <Input value={el.label} placeholder="e.g. Technology" onChange={(e) => setCustom(custom.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                    <Button tone="ghost" size="sm" onClick={() => setCustom(custom.filter((_, j) => j !== i))}>✕</Button>
                  </div>
                ))}
                <Button size="sm" onClick={() => setCustom([...custom, { key: `${keyOf('element')}_${Date.now().toString(36)}`, label: '' }])}>+ Element</Button>
              </div>
            </div>
          )}
          <p className="text-xs text-stone-500">Element texts you already wrote are kept when you switch frameworks; elements with the same name (e.g. Population) carry over.</p>
        </Card>
      </section>

      <section>
        <SectionTitle title="Steps and features" />
        <Card className="space-y-4 p-5">
          <Toggle checked={s.appraisal} onChange={(v) => setS({ appraisal: v })} label="Critical appraisal / risk of bias"
            hint="Adds an appraisal step for the included sources (RoB 2, ROBINS-I, CASP or your own checklist), with independent appraisers and consensus. Usually on for systematic reviews, optional for scoping reviews." />
          <Toggle checked={s.streams} onChange={(v) => setS({ streams: v })} label="Search streams"
            hint="Group search runs into streams (e.g. one per review question, with primary and supplementary queries) and build database-specific queries from shared term blocks." />
          <div className="flex items-center gap-3 text-sm">
            <span>Calibration set size</span>
            <Input className="w-24" type="number" min={5} max={200} value={s.calibrationSize} onChange={(e) => setS({ calibrationSize: Number(e.target.value) || 20 })} />
            <span className="text-xs text-stone-400">first records of each stage, screened as a practice round</span>
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle title="Deduplication" hint="Used for every new import. Re-running applies the mode to all records already imported." />
        <Card className="space-y-3 p-5">
          {DEDUP_MODES.map((m) => (
            <label key={m.value} className="flex items-start gap-3 text-sm">
              <input type="radio" name="dedup" className="mt-1" checked={s.dedup === m.value} onChange={() => setS({ dedup: m.value })} />
              {m.label}
            </label>
          ))}
          <div className="flex items-center gap-3 border-t border-stone-100 pt-3">
            <Button size="sm" onClick={applyDedup} disabled={!review.records.length || dedupPreview.changed === 0}>Re-run deduplication now</Button>
            <span className="text-xs text-stone-500">
              {review.records.length ? `Currently ${dedupPreview.before} duplicates; with this mode ${dedupPreview.after} (${dedupPreview.changed} records change).` : 'No records yet.'}
            </span>
          </div>
          {dedupMsg && <div className="bg-indigo-50 px-3 py-2 text-sm text-indigo-900">{dedupMsg}</div>}
        </Card>
      </section>

      <section>
        <SectionTitle title="Workspace" hint="Where ReviewHub stores reviews, PDFs, imports and backups. Shared by all reviews on this computer." />
        <Card className="p-5 text-sm">
          {/* Switching folders affects every review; go back to the start page so the review list is reloaded. */}
          <WorkspaceEditor onChanged={(r) => { if (!r.unchanged) setTimeout(() => window.location.assign('/'), 1800); }} />
        </Card>
      </section>
    </div>
  );
}
