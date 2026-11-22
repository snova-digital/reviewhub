import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { LogoMark, Wordmark } from './Logo.jsx';

/* Black House-style top bar. Global context only: logo, the review switcher (start page + every review),
   and on the right whatever the page passes in (save status, active reviewer). Navigation *within*
   a review lives exclusively in the left sidebar. */

function Brand() {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2.5 text-white" title="ReviewHub start page">
      <LogoMark className="h-12 w-12 -my-1" />
      <Wordmark />
    </Link>
  );
}

/* Dropdown next to the logo: shows where you are (start page or the open review) and lets you jump to another review. */
function ReviewSwitcher({ current }) {
  const [open, setOpen] = useState(false);
  const [reviews, setReviews] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    api.listReviews().then(setReviews).catch(() => setReviews([]));
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const item = (active) => `block px-5 py-2.5 hover:bg-stone-100 ${active ? 'border-l-4 border-brand-teal bg-stone-50 pl-4 font-bold' : ''}`;

  return (
    <div ref={ref} className="relative flex h-full min-w-0 items-center" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex min-w-0 max-w-[36rem] items-center gap-3 rounded px-3 py-2 text-left text-white hover:bg-white/10"
      >
        <span className="min-w-0">
          <span className="block text-[11px] font-light lowercase text-white/60">{current ? `${current.type} review` : 'all reviews'}</span>
          <span className="block truncate text-[15px] font-medium">{current ? current.title : 'start page'}</span>
        </span>
        <svg viewBox="0 0 24 24" className={`h-5 w-5 shrink-0 text-white/80 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="square" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-50 w-[26rem] bg-white text-black shadow-[0_6px_18px_rgba(0,0,0,0.18)]">
          <Link to="/" onClick={() => setOpen(false)} className={`${item(!current)} lowercase`}>
            ← start page <span className="text-sm font-light text-stone-500">· all reviews, new review, choose reviewer</span>
          </Link>
          <div className="border-t border-stone-200 px-5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[0.15em] text-stone-500">reviews</div>
          <nav className="max-h-[60vh] overflow-y-auto pb-2">
            {!reviews && <div className="px-5 py-2.5 text-sm text-stone-500">Loading…</div>}
            {reviews?.map((r) => (
              <Link key={r.id} to={`/r/${r.id}`} onClick={() => setOpen(false)} className={item(r.id === current?.id)}>
                <span className="line-clamp-2 text-[15px] leading-snug">{r.title}</span>
                <span className="text-xs font-light lowercase text-stone-500">{r.type} review · {r.records} records</span>
              </Link>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}

export default function TopBar({ review, right }) {
  return (
    <header className="relative z-40 shrink-0 bg-black">
      <div className="flex h-[72px] items-center gap-6 px-6">
        <Brand />
        <span className="h-8 w-px bg-white/25" aria-hidden />
        <ReviewSwitcher current={review} />
        <div className="flex-1" />
        {right && <div className="flex shrink-0 items-center text-sm text-white/90">{right}</div>}
      </div>
    </header>
  );
}
