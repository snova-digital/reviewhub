// VOSviewer-style network view: node size = occurrences, link width = co-occurrence strength,
// colour = cluster. Hover highlights a node's neighbourhood; click selects its sources. Wheel zooms, drag pans.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import { seriesColor, useTooltip } from './charts.jsx';

const W = 1000;
const H = 680;

function layout(net) {
  const maxOcc = Math.max(1, ...net.nodes.map((n) => n.occurrences));
  const nodes = net.nodes.map((n) => ({ ...n, r: 5 + 19 * Math.sqrt(n.occurrences / maxOcc) }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = net.links.map((l) => ({ ...l, source: byId.get(l.source), target: byId.get(l.target) }));
  const maxW = Math.max(1, ...links.map((l) => l.weight));
  // Deterministic start positions (a spiral), so the same data gives the same picture.
  nodes.forEach((n, i) => { const a = i * 2.39996; const d = 12 * Math.sqrt(i + 1); n.x = W / 2 + d * Math.cos(a); n.y = H / 2 + d * Math.sin(a); });
  const sim = forceSimulation(nodes)
    .force('link', forceLink(links).id((d) => d.id).distance((l) => 90 - 50 * (l.weight / maxW)).strength((l) => 0.15 + 0.6 * (l.weight / maxW)))
    .force('charge', forceManyBody().strength(-140))
    .force('collide', forceCollide((d) => d.r + 3))
    .force('x', forceX(W / 2).strength(0.04))
    .force('y', forceY(H / 2).strength(0.06))
    .force('center', forceCenter(W / 2, H / 2))
    .stop();
  for (let i = 0; i < 400; i++) sim.tick();
  // Fit into the viewport.
  const xs = nodes.map((n) => n.x); const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs) - 40; const maxX = Math.max(...xs) + 40; const minY = Math.min(...ys) - 30; const maxY = Math.max(...ys) + 30;
  const k = Math.min(W / (maxX - minX || 1), H / (maxY - minY || 1), 3.5);
  for (const n of nodes) { n.x = (n.x - minX) * k + (W - (maxX - minX) * k) / 2; n.y = (n.y - minY) * k + (H - (maxY - minY) * k) / 2; }
  return { nodes, links, maxW };
}

const NetworkView = forwardRef(function NetworkView({ net, onSelect, labelCount = 40 }, ref) {
  const { nodes, links, maxW } = useMemo(() => layout(net), [net]);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null);
  const svg = useRef();
  const drag = useRef(null);
  const t = useTooltip();
  useEffect(() => { setView({ x: 0, y: 0, k: 1 }); setSelected(null); }, [net]);

  const neighbours = useMemo(() => {
    const m = new Map(nodes.map((n) => [n.id, new Set([n.id])]));
    for (const l of links) { m.get(l.source.id).add(l.target.id); m.get(l.target.id).add(l.source.id); }
    return m;
  }, [nodes, links]);
  const focus = hover || selected;
  const near = focus ? neighbours.get(focus) : null;
  const labelled = useMemo(() => new Set([...nodes].sort((a, b) => b.occurrences - a.occurrences).slice(0, labelCount).map((n) => n.id)), [nodes, labelCount]);

  useImperativeHandle(ref, () => ({
    svgMarkup: () => {
      const clone = svg.current.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', W); clone.setAttribute('height', H);
      return `<?xml version="1.0" encoding="UTF-8"?>\n${clone.outerHTML}`;
    },
    reset: () => setView({ x: 0, y: 0, k: 1 }),
  }));

  // Wheel zoom around the pointer (non-passive listener so the page does not scroll).
  useEffect(() => {
    const el = svg.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      const px = ((e.clientX - box.left) / box.width) * W; const py = ((e.clientY - box.top) / box.height) * H;
      setView((v) => {
        const k = Math.min(8, Math.max(0.3, v.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const toSvg = (e) => { const box = svg.current.getBoundingClientRect(); return [(e.clientX - box.left) / box.width * W, (e.clientY - box.top) / box.height * H]; };
  const onDown = (e) => { if (e.target.dataset.node) return; drag.current = { start: toSvg(e), view, moved: false }; };
  const onMove = (e) => {
    if (!drag.current) return;
    const [x, y] = toSvg(e);
    const dx = x - drag.current.start[0]; const dy = y - drag.current.start[1];
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    setView({ ...drag.current.view, x: drag.current.view.x + dx, y: drag.current.view.y + dy });
  };
  const onUp = () => { if (drag.current && !drag.current.moved) { setSelected(null); onSelect?.(null); } drag.current = null; };

  if (!nodes.length) return <div className="flex h-64 items-center justify-center text-sm text-stone-500">No items meet the thresholds. Lower the minimum occurrences.</div>;
  const width = (l) => 0.6 + 4.4 * (l.weight / maxW);

  return (
    <div ref={t.ref} className="relative">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="w-full cursor-grab touch-none select-none bg-white active:cursor-grabbing" role="img" aria-label="Co-occurrence network"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { drag.current = null; }}
        fontFamily="Roboto, sans-serif">
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {links.map((l) => {
            const on = focus && (l.source.id === focus || l.target.id === focus);
            return (
              <line key={`${l.source.id}|${l.target.id}`} x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y}
                stroke={on ? seriesColor(nodes.find((n) => n.id === focus)?.cluster) : '#9e9e9e'}
                strokeOpacity={focus ? (on ? 0.85 : 0.06) : 0.28} strokeWidth={width(l) / Math.sqrt(view.k)} strokeLinecap="round" />
            );
          })}
          {nodes.map((n) => {
            const dim = near && !near.has(n.id);
            return (
              <circle key={n.id} data-node="1" cx={n.x} cy={n.y} r={n.r} fill={seriesColor(n.cluster)} fillOpacity={dim ? 0.15 : 0.9}
                stroke="#ffffff" strokeWidth={2 / view.k} className="cursor-pointer"
                onMouseEnter={() => setHover(n.id)}
                onMouseMove={(e) => t.show(e, <><b>{n.label}</b><br />{n.occurrences} occurrence{n.occurrences === 1 ? '' : 's'} · {n.links} link{n.links === 1 ? '' : 's'} · total link strength {n.strength}</>)}
                onMouseLeave={() => { setHover(null); t.hide(); }}
                onClick={() => { setSelected(n.id); onSelect?.({ label: n.label, ids: n.ids }); }} />
            );
          })}
          {nodes.map((n) => {
            const show = near ? near.has(n.id) : labelled.has(n.id);
            if (!show) return null;
            const fs = Math.max(10, Math.min(16, 9 + n.r / 3)) / Math.sqrt(view.k);
            return (
              <text key={`t${n.id}`} x={n.x} y={n.y - n.r - 3 / view.k} textAnchor="middle" fontSize={fs} fill="#111111"
                fontWeight={n.id === focus ? 700 : 400} paintOrder="stroke" stroke="#ffffff" strokeWidth={3 / view.k} strokeLinejoin="round" pointerEvents="none">
                {n.label.length > 34 ? `${n.label.slice(0, 34)}…` : n.label}
              </text>
            );
          })}
        </g>
      </svg>
      {t.node}
    </div>
  );
});

export default NetworkView;
