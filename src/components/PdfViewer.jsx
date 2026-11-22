// PDF viewer with text selection → evidence highlights.
// Highlights are stored zoom-independent as page-relative rectangles (0..1).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Button, Select, Input } from './ui.jsx';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const COLORS = {
  inclusion: 'bg-emerald-300/45 ring-emerald-500',
  exclusion: 'bg-rose-300/45 ring-rose-500',
  general: 'bg-yellow-300/50 ring-yellow-500',
};

function mergeRects(rects) {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && Math.abs(last.y - r.y) < 0.004 && Math.abs(last.h - r.h) < 0.006 && r.x <= last.x + last.w + 0.01) {
      const right = Math.max(last.x + last.w, r.x + r.w);
      last.x = Math.min(last.x, r.x); last.w = right - last.x;
    } else if (!out.some((o) => Math.abs(o.x - r.x) < 0.002 && Math.abs(o.y - r.y) < 0.002 && Math.abs(o.w - r.w) < 0.002)) {
      out.push({ ...r });
    }
  }
  return out;
}

const PdfViewer = forwardRef(function PdfViewer({ url, highlights, activeId, onSelectHighlight, onAddHighlight, criteria, kindOf, generalLabel = 'General evidence (no specific criterion)' }, ref) {
  const scroller = useRef();
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [pending, setPending] = useState(null); // { page, text, rects, top, left }
  const [critId, setCritId] = useState('');
  const [comment, setComment] = useState('');
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(scroller.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { setNumPages(0); setPending(null); setLoadError(null); }, [url]);

  const scrollTo = useCallback((h) => {
    const pageEl = scroller.current?.querySelector(`[data-page-number="${h.page}"]`);
    if (!pageEl) return;
    const y = h.rects?.[0]?.y ?? 0;
    scroller.current.scrollTo({ top: pageEl.offsetTop + y * pageEl.clientHeight - 120, behavior: 'smooth' });
  }, []);
  useImperativeHandle(ref, () => ({ scrollTo }), [scrollTo]);

  function onMouseUp() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 2) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const pageEl = node?.closest('[data-page-number]');
    if (!pageEl || !scroller.current.contains(pageEl)) return;
    const pr = pageEl.getBoundingClientRect();
    const rects = mergeRects(
      [...range.getClientRects()]
        .filter((r) => r.width > 1 && r.height > 1 && r.bottom > pr.top && r.top < pr.bottom)
        .map((r) => ({ x: (r.left - pr.left) / pr.width, y: (r.top - pr.top) / pr.height, w: r.width / pr.width, h: r.height / pr.height })),
    );
    if (!rects.length) return;
    const last = [...range.getClientRects()].at(-1);
    const sr = scroller.current.getBoundingClientRect();
    setPending({
      page: Number(pageEl.dataset.pageNumber),
      text,
      rects,
      top: last.bottom - sr.top + scroller.current.scrollTop + 6,
      left: Math.min(Math.max(8, last.left - sr.left), sr.width - 340),
    });
    setComment('');
  }

  function commit() {
    onAddHighlight({ page: pending.page, text: pending.text, rects: pending.rects, criterionId: critId || null, comment });
    window.getSelection()?.removeAllRanges();
    setPending(null);
  }

  const pageWidth = Math.max(300, (width - 48) * zoom);

  return (
    <div className="relative flex h-full flex-col bg-stone-200/70">
      <div className="flex items-center gap-2 border-b border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-600">
        <Button size="sm" tone="ghost" onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))}>−</Button>
        <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button size="sm" tone="ghost" onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))}>+</Button>
        <Button size="sm" tone="ghost" onClick={() => setZoom(1)}>Fit width</Button>
        <span className="ml-2">{numPages ? `${numPages} pages` : ''}</span>
        <span className="ml-auto text-stone-400">Select text to mark it as evidence</span>
        <a className="text-indigo-700 hover:underline" href={url} target="_blank" rel="noreferrer">Open in new tab ↗</a>
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto" onMouseUp={onMouseUp}>
        <Document
          file={url}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          onLoadError={(e) => setLoadError(e)}
          loading={<div className="p-10 text-center text-sm text-stone-500">Loading PDF…</div>}
          error={<div className="p-10 text-center text-sm text-rose-700">Could not load PDF. {loadError?.message}</div>}
          className="flex flex-col items-center gap-4 py-6"
        >
          {Array.from({ length: numPages }, (_, i) => (
            <Page key={i + 1} pageNumber={i + 1} width={pageWidth} className="relative shadow-md" renderAnnotationLayer renderTextLayer>
              {highlights.filter((h) => h.page === i + 1).map((h) => (
                (h.rects || []).map((r, k) => (
                  <div
                    key={`${h.id}-${k}`}
                    className={`pointer-events-none absolute z-[1] rounded-[2px] mix-blend-multiply ${COLORS[kindOf(h.criterionId)] || COLORS.general} ${activeId === h.id ? 'ring-2' : ''}`}
                    style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
                    onClick={() => onSelectHighlight?.(h.id)}
                  />
                ))
              ))}
            </Page>
          ))}
        </Document>

        {pending && (
          <div
            className="absolute z-20 w-[330px] rounded-lg border border-stone-200 bg-white p-3 shadow-xl"
            style={{ top: pending.top, left: pending.left }}
            onMouseUp={(e) => e.stopPropagation()}
          >
            <div className="mb-2 line-clamp-3 border-l-2 border-yellow-400 pl-2 text-xs italic text-stone-600">“{pending.text}”</div>
            <Select value={critId} onChange={(e) => setCritId(e.target.value)}>
              <option value="">{generalLabel}</option>
              {criteria.map((c) => <option key={c.id} value={c.id}>{c.code}: {c.text.slice(0, 70)}</option>)}
            </Select>
            <div className="mt-2"><Input placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commit()} autoFocus /></div>
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" tone="ghost" onClick={() => { setPending(null); window.getSelection()?.removeAllRanges(); }}>Cancel</Button>
              <Button size="sm" tone="primary" onClick={commit}>Add evidence</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default PdfViewer;
