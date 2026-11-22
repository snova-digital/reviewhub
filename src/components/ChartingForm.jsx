// Charting form (structured data extraction): the editor for the form, and the fields a coder fills in per source.
// The form lives in review.chartingForm; values per reviewer in decisions.coding[recordId].fields[fieldId].
import { useReview } from '../lib/store.jsx';
import { chartingTemplate, newField } from '../lib/model.js';
import { CHARTING_TEMPLATES, FIELD_TYPES, guide, profileOf } from '../lib/methods.js';
import { Button, Card, Empty, Input, SectionTitle, Select, Textarea } from './ui.jsx';

const hasOptions = (t) => t === 'select' || t === 'multiselect';

export default function ChartingForm() {
  const { review, update } = useReview();
  const fields = review.chartingForm || [];
  const setFields = (fn) => update((r) => ({ ...r, chartingForm: fn(r.chartingForm || []) }));
  const set = (id, patch) => setFields((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const move = (id, dir) => setFields((list) => {
    const arr = [...list]; const i = arr.findIndex((f) => f.id === id); const j = i + dir;
    if (j < 0 || j >= arr.length) return list;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return arr;
  });
  const remove = (f) => { if (confirm(`Delete the field "${f.label || 'untitled'}"? Values already entered stay in the reviewer files but are no longer shown.`)) setFields((list) => list.filter((x) => x.id !== f.id)); };
  const insert = (key) => setFields((list) => [...list, ...chartingTemplate(key).filter((t) => !list.some((x) => x.label === t.label))]);
  const preferred = profileOf(review).charting;

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <SectionTitle
        title="Charting form"
        hint={`${guide(review, 'charting')} Fields of type "one of a list" can be cross-tabulated against codes and years under Results & analysis.`}
        actions={<>
          {Object.entries(CHARTING_TEMPLATES).map(([k, t]) => (
            <Button key={k} tone={k === preferred && !fields.length ? 'primary' : 'secondary'} onClick={() => insert(k)}>Insert {t.label.charAt(0).toLowerCase() + t.label.slice(1)}</Button>
          ))}
          <Button tone={fields.length ? 'primary' : 'secondary'} onClick={() => setFields((list) => [...list, newField()])}>+ Field</Button>
        </>}
      />
      {!fields.length && <Empty title="No charting form yet">Insert a template and adapt it to your review questions, or add fields one by one. Pilot the form on 2–3 sources with all reviewers before charting everything.</Empty>}
      <div className="space-y-2">
        {fields.map((f) => (
          <Card key={f.id} className="flex items-start gap-3 p-3">
            <div className="grid flex-1 grid-cols-[1fr_12rem] gap-2">
              <Input placeholder="Field label, e.g. Country" value={f.label} onChange={(e) => set(f.id, { label: e.target.value })} />
              <Select value={f.type} onChange={(e) => set(f.id, { type: e.target.value })}>
                {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
              <Input placeholder="Help text for coders (optional)" value={f.help || ''} onChange={(e) => set(f.id, { help: e.target.value })} />
              <div />
              {hasOptions(f.type) && (
                <Textarea rows={2} className="col-span-2" placeholder="Options, one per line"
                  value={(f.options || []).join('\n')} onChange={(e) => set(f.id, { options: e.target.value.split('\n') })} />
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Button tone="ghost" size="sm" onClick={() => move(f.id, -1)}>↑</Button>
              <Button tone="ghost" size="sm" onClick={() => move(f.id, 1)}>↓</Button>
              <Button tone="ghost" size="sm" onClick={() => remove(f)}>✕</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// The fields as a coder sees them in the coding sidebar.
export function ChartingFields({ fields, values, onChange }) {
  return (
    <div className="space-y-2.5">
      {fields.map((f) => {
        const v = values[f.id];
        const opts = (f.options || []).map((o) => o.trim()).filter(Boolean);
        return (
          <label key={f.id} className="block">
            <span className="text-xs font-medium text-stone-600">{f.label || '(untitled field)'}</span>
            {f.help && <span className="block text-[11px] text-stone-400">{f.help}</span>}
            <div className="mt-0.5">
              {f.type === 'longtext' && <Textarea rows={2} value={v || ''} onChange={(e) => onChange(f.id, e.target.value)} />}
              {f.type === 'text' && <Input value={v || ''} onChange={(e) => onChange(f.id, e.target.value)} />}
              {f.type === 'number' && <Input type="number" value={v ?? ''} onChange={(e) => onChange(f.id, e.target.value === '' ? null : Number(e.target.value))} />}
              {f.type === 'select' && (
                <Select value={v || ''} onChange={(e) => onChange(f.id, e.target.value || null)}>
                  <option value="">–</option>
                  {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              )}
              {f.type === 'yesno' && (
                <Select value={v || ''} onChange={(e) => onChange(f.id, e.target.value || null)}>
                  <option value="">–</option><option value="yes">Yes</option><option value="no">No</option><option value="unclear">Unclear</option>
                </Select>
              )}
              {f.type === 'multiselect' && (
                <div className="flex flex-wrap gap-1">
                  {opts.map((o) => {
                    const on = (v || []).includes(o);
                    return (
                      <button key={o} type="button" onClick={() => onChange(f.id, on ? v.filter((x) => x !== o) : [...(v || []), o])}
                        className={`border px-2 py-0.5 text-xs ${on ? 'border-indigo-400 bg-indigo-50 text-indigo-900' : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'}`}>{o}</button>
                    );
                  })}
                </div>
              )}
            </div>
          </label>
        );
      })}
    </div>
  );
}
