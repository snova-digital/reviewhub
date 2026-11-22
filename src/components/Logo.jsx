/* ReviewHub mark: a screening funnel. Bars narrow from many records to few, ending in the
   diamond (the included evidence, echoing the 45° arrow tabs). One brand colour per stage.
   Same geometry as public/favicon.svg, minus the black tile. */
export function LogoMark({ className = 'h-9 w-9' }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="4" y="4" width="24" height="5" fill="#4eacb8" />
      <rect x="8" y="11" width="16" height="5" fill="#ebb53f" />
      <rect x="12" y="18" width="8" height="5" fill="#6dcfb6" />
      <path d="M16 24.5l3.5 3.5-3.5 3.5-3.5-3.5z" fill="#9b84d4" />
    </svg>
  );
}

export function Wordmark({ className = 'text-[22px]' }) {
  return <span className={`font-bold tracking-tight ${className}`}>Review<span className="text-brand-teal">Hub</span></span>;
}
