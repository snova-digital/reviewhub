// Small SVG/HTML chart primitives for Results & analysis: vertical bars, ranked horizontal bars, heatmap.
// Colour rules: one sequential hue (teal) for magnitude, a fixed categorical order for clusters (validated for
// colour-vision deficiency), text always in ink colours, every mark has a hover tooltip and is clickable.
import { useRef, useState } from 'react';

// Categorical slots in fixed order (never cycled). Slots past 8 fold into OTHER.
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const OTHER = '#9e9e9e';
export const seriesColor = (cluster) => (cluster >= 1 && cluster <= SERIES.length ? SERIES[cluster - 1] : OTHER);
export const BAR = '#3b8f9a';
// Sequential teal ramp (light → dark) for heatmap cells.
const RAMP = ['#d5eef1', '#addde3', '#80c8d1', '#5fb6c1', '#4eacb8', '#3b8f9a', '#2f7680', '#285f67', '#234f55'];
export const rampColor = (t) => RAMP[Math.min(RAMP.length - 1, Math.max(0, Math.round(t * (RAMP.length - 1))))];
const inkOn = (hex) => { const n = parseInt(hex.slice(1), 16); const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l > 0.6 ? '#111111' : '#ffffff'; };

// Tooltip that follows the pointer inside a relatively positioned container.
export function useTooltip() {
  const ref = useRef();
  const [tip, setTip] = useState(null);
  const show = (e, content) => {
    const box = ref.current?.getBoundingClientRect();
    if (box) setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content, w: box.width });
  };
  const node = tip && (
    <div className="pointer-events-none absolute z-20 max-w-xs bg-black px-2.5 py-1.5 text-xs text-white shadow-lg"
      style={{ left: Math.min(tip.x + 12, tip.w - 200), top: tip.y + 12 }}>{tip.content}</div>
  );
  return { ref, show, hide: () => setTip(null), node };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Vertical bars over an ordered category axis (e.g. years).
export function ColumnChart({ data, onSelect, unit = 'source', height = 200 }) {
  const t = useTooltip();
  if (!data.length) return <div className="py-6 text-sm text-stone-500">No data.</div>;
  const max = Math.max(...data.map((d) => d.ids.length));
  const W = 640; const H = height; const padL = 28; const padB = 22; const padT = 8;
  const bw = (W - padL) / data.length;
  const ticks = [...new Set([0, Math.ceil(max / 2), max])];
  const y = (v) => H - padB - ((H - padB - padT) * v) / (max || 1);
  const labelEvery = Math.ceil(data.length / 16);
  return (
    <div ref={t.ref} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Bar chart: ${unit}s per category`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W} y1={y(v)} y2={y(v)} stroke="#e2e2e2" strokeWidth="1" />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#6b6b6b">{v}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * bw + 1; const w = Math.max(1, bw - 2); const top = y(d.ids.length); const h = H - padB - top;
          return (
            <g key={d.label} className="cursor-pointer" onClick={() => onSelect?.(d)}
              onMouseMove={(e) => t.show(e, <><b>{d.label}</b>: {plural(d.ids.length, unit)}</>)} onMouseLeave={t.hide}>
              <rect x={padL + i * bw} y={padT} width={bw} height={H - padB - padT} fill="transparent" />
              {h > 0 && <path d={`M${x},${H - padB} V${top + Math.min(4, h)} Q${x},${top} ${x + Math.min(4, w / 2)},${top} H${x + w - Math.min(4, w / 2)} Q${x + w},${top} ${x + w},${top + Math.min(4, h)} V${H - padB} Z`} fill={BAR} />}
              {i % labelEvery === 0 && <text x={padL + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#4f4f4f">{d.label}</text>}
            </g>
          );
        })}
        <line x1={padL} x2={W} y1={H - padB} y2={H - padB} stroke="#9e9e9e" strokeWidth="1" />
      </svg>
      {t.node}
    </div>
  );
}

// Ranked horizontal bars with the count at the bar end (a compact, labelled list).
export function BarList({ data, onSelect, total, unit = 'source', max: maxRows = 15 }) {
  const t = useTooltip();
  if (!data.length) return <div className="py-3 text-sm text-stone-500">No data yet.</div>;
  const rows = data.slice(0, maxRows);
  const max = Math.max(...rows.map((d) => d.ids.length));
  return (
    <div ref={t.ref} className="relative space-y-1">
      {rows.map((d) => (
        <button key={d.label} type="button" onClick={() => onSelect?.(d)}
          onMouseMove={(e) => t.show(e, <><b>{d.label}</b>: {plural(d.ids.length, unit)}{total ? ` (${Math.round((100 * d.ids.length) / total)}%)` : ''}</>)} onMouseLeave={t.hide}
          className="grid w-full grid-cols-[minmax(0,14rem)_1fr_2.5rem] items-center gap-3 py-0.5 text-left text-sm hover:bg-stone-50">
          <span className="truncate text-stone-700">{d.label}</span>
          <span className="h-3"><span className="block h-full rounded-r" style={{ width: `${Math.max(2, (100 * d.ids.length) / max)}%`, background: BAR }} /></span>
          <span className="text-right text-xs tabular-nums text-stone-600">{d.ids.length}</span>
        </button>
      ))}
      {data.length > maxRows && <div className="pt-1 text-xs text-stone-400">+ {data.length - maxRows} more</div>}
      {t.node}
    </div>
  );
}

// Heatmap / evidence map: rows × columns with record counts; empty cells show the gaps.
export function Heatmap({ table, onSelect, rowLabel, colLabel }) {
  const t = useTooltip();
  const { rows, cols, cells } = table;
  if (!rows.length || !cols.length) return <div className="py-6 text-sm text-stone-500">Nothing to cross-tabulate for these dimensions yet.</div>;
  const max = Math.max(1, ...cells.flat().map((c) => c.length));
  return (
    <div ref={t.ref} className="relative overflow-auto">
      <table className="border-separate text-xs" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-white px-2 text-left align-bottom font-medium text-stone-500">{rowLabel} ↓ · {colLabel} →</th>
            {cols.map((c) => (
              <th key={c.label} className="h-28 min-w-9 align-bottom font-normal text-stone-600">
                <div className="mx-auto w-4 whitespace-nowrap [writing-mode:vertical-rl] rotate-180 text-left" title={c.label}>{c.label.length > 28 ? `${c.label.slice(0, 28)}…` : c.label}</div>
              </th>
            ))}
            <th className="px-2 align-bottom font-medium text-stone-500">Σ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.label}>
              <th className="sticky left-0 z-10 max-w-64 truncate bg-white px-2 py-1 text-left font-normal text-stone-700" title={r.label}>{r.label}</th>
              {cols.map((c, j) => {
                const ids = cells[i][j];
                const bg = ids.length ? rampColor(ids.length / max) : '#ffffff';
                return (
                  <td key={c.label} onClick={() => ids.length && onSelect?.({ label: `${r.label} × ${c.label}`, ids })}
                    onMouseMove={(e) => t.show(e, <><b>{r.label}</b> × <b>{c.label}</b>: {plural(ids.length, 'source')}</>)} onMouseLeave={t.hide}
                    className={`h-8 min-w-9 text-center tabular-nums ${ids.length ? 'cursor-pointer' : 'ring-1 ring-inset ring-stone-200'}`}
                    style={{ background: bg, color: ids.length ? inkOn(bg) : '#cfcfcf' }}>
                    {ids.length || '·'}
                  </td>
                );
              })}
              <td className="px-2 text-center tabular-nums text-stone-600">{r.ids.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {t.node}
    </div>
  );
}
