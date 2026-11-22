// Evidence excerpts: passages from the paper that document a decision (full text) or a code (coding).
// Two ways in: select text in the PDF viewer, or paste it here (e.g. from an HTML full text, a PDF that
// cannot be selected, or a quote copied from elsewhere). Each excerpt keeps page, link and comment.
import { useState } from 'react';
import { Button, Card, Input, Select, Textarea } from './ui.jsx';

const BORDER = { inclusion: 'border-emerald-500', exclusion: 'border-rose-500', general: 'border-yellow-500' };

// options: [{ id, code, text }]; multi = link to several options (codes) instead of one (criterion)
export function PasteExcerpt({ options, multi, onAdd, linkLabel }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [page, setPage] = useState('');
  const [link, setLink] = useState(multi ? [] : '');
  const [comment, setComment] = useState('');
  const add = () => {
    if (!text.trim()) return;
    onAdd({ text: text.trim(), page: page ? Number(page) || page : null, rects: [], source: 'paste', comment, ...(multi ? { codeIds: link } : { criterionId: link || null }) });
    setText(''); setPage(''); setComment(''); setLink(multi ? [] : '');
  };
  if (!open) return <Button size="sm" className="w-full" onClick={() => setOpen(true)}>+ Paste an excerpt</Button>;
  return (
    <Card className="space-y-2 p-3">
      <div className="text-xs text-stone-500">
        Copy a passage from the paper (PDF, publisher HTML page, …) and paste it here. Add the page so others can find it,
        and link it to {multi ? 'one or more codes' : 'the criterion it supports'}. It is stored as a verbatim quote with your decision.
      </div>
      <Textarea rows={4} placeholder="Paste the verbatim passage…" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      <div className="flex gap-2">
        <Input className="w-20" placeholder="Page" value={page} onChange={(e) => setPage(e.target.value)} />
        {!multi && (
          <Select value={link} onChange={(e) => setLink(e.target.value)}>
            <option value="">General evidence</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.code}: {o.text.slice(0, 60)}</option>)}
          </Select>
        )}
      </div>
      {multi && <ChipPicker options={options} value={link} onChange={setLink} label={linkLabel} />}
      <Input placeholder="Comment / paraphrase (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button size="sm" tone="ghost" onClick={() => setOpen(false)}>Close</Button>
        <Button size="sm" tone="primary" disabled={!text.trim()} onClick={add}>Add excerpt</Button>
      </div>
    </Card>
  );
}

export function ChipPicker({ options, value, onChange, label = 'Codes' }) {
  if (!options.length) return <div className="text-xs text-stone-400">No {label.toLowerCase()} defined yet.</div>;
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button key={o.id} type="button" onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])}
            className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${on ? 'bg-indigo-600 text-white ring-indigo-600' : 'text-stone-700 ring-stone-300 hover:bg-stone-100'}`}>
            {o.code}
          </button>
        );
      })}
    </div>
  );
}

export function EvidenceList({ items, options, multi, kindOf, activeId, onActivate, onRelink, onRemove, empty }) {
  if (!items.length) return <div className="text-sm text-stone-500">{empty}</div>;
  return (
    <div className="space-y-2">
      {items.map((h) => (
        <Card key={h.id} className={`cursor-pointer p-3 text-sm ${activeId === h.id ? 'ring-2 ring-indigo-300' : ''}`} onClick={() => onActivate?.(h)}>
          <div className={`border-l-2 pl-2 text-xs italic text-stone-700 ${BORDER[kindOf?.(h.criterionId) || 'general']}`}>“{h.text}”</div>
          {h.comment && <div className="mt-1.5 text-xs text-stone-600">{h.comment}</div>}
          <div className="mt-2 flex items-center gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
            <span className="shrink-0 text-stone-400">{h.page ? `p. ${h.page}` : 'no page'}{h.source === 'paste' ? ' · pasted' : ''}</span>
            {!multi && (
              <select className="min-w-0 flex-1 rounded border border-stone-200 bg-white px-1 py-0.5" value={h.criterionId || ''} onChange={(e) => onRelink(h.id, e.target.value || null)}>
                <option value="">General evidence</option>
                {options.map((o) => <option key={o.id} value={o.id}>{o.code}: {o.text.slice(0, 50)}</option>)}
              </select>
            )}
            {multi && <span className="flex-1" />}
            <button className="text-stone-400 hover:text-rose-600" onClick={() => onRemove(h.id)}>✕</button>
          </div>
          {multi && <div className="mt-2" onClick={(e) => e.stopPropagation()}><ChipPicker options={options} value={h.codeIds || []} onChange={(v) => onRelink(h.id, v)} /></div>}
        </Card>
      ))}
    </div>
  );
}
