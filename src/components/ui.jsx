const tones = {
  primary: 'bg-black text-white hover:bg-brand-teal disabled:bg-stone-300',
  secondary: 'bg-white text-stone-800 ring-1 ring-stone-300 hover:bg-stone-100 disabled:text-stone-400',
  ghost: 'text-stone-600 hover:bg-stone-200/60 hover:text-stone-900',
  danger: 'bg-white text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50',
  emerald: 'bg-emerald-600 text-white hover:bg-emerald-700',
  amber: 'bg-amber-500 text-white hover:bg-amber-600',
  rose: 'bg-rose-600 text-white hover:bg-rose-700',
  stone: 'bg-stone-600 text-white hover:bg-stone-700',
};

export function Button({ tone = 'secondary', size = 'md', className = '', ...p }) {
  const sz = size === 'sm' ? 'px-2.5 py-1 text-xs' : size === 'lg' ? 'px-5 py-2.5 text-sm' : 'px-3.5 py-1.5 text-sm';
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed ${sz} ${tones[tone]} ${className}`}
      {...p}
    />
  );
}

export function Card({ className = '', children, ...p }) {
  return <div className={`rounded-lg border border-stone-200 bg-white ${className}`} {...p}>{children}</div>;
}

export function SectionTitle({ title, hint, actions }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 className="brand-bar text-2xl font-bold tracking-tight text-black">{title}</h2>
        {hint && <p className="mt-3 max-w-3xl text-sm font-light text-stone-600">{hint}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-stone-400">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm shadow-xs placeholder:text-stone-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 focus:outline-none';

export const Input = ({ className = '', ...p }) => <input className={`${inputCls} ${className}`} {...p} />;
export const Textarea = ({ rows = 3, className = '', ...p }) => <textarea rows={rows} className={`${inputCls} leading-relaxed ${className}`} {...p} />;
export const Select = ({ children, className = '', ...p }) => <select className={`${inputCls} ${className}`} {...p}>{children}</select>;

const badgeTones = {
  include: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  exclude: 'bg-rose-50 text-rose-700 ring-rose-200',
  unclear: 'bg-amber-50 text-amber-800 ring-amber-200',
  not_retrieved: 'bg-stone-100 text-stone-600 ring-stone-300',
  pending: 'bg-white text-stone-500 ring-stone-200',
  duplicate: 'bg-violet-50 text-violet-700 ring-violet-200',
  info: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
};
const badgeLabels = { not_retrieved: 'not retrieved' };

export function Badge({ tone = 'pending', children }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${badgeTones[tone] || badgeTones.pending}`}>
      {children ?? badgeLabels[tone] ?? tone}
    </span>
  );
}

/* Key figure: huge black number, lowercase label, short bar beneath. */
export function Stat({ label, value, sub }) {
  return (
    <div className="py-2">
      <div className="text-5xl font-black leading-none tracking-tight tabular-nums text-black">{value}</div>
      <div className="mt-3 text-[15px] lowercase text-black">{label}</div>
      <span className="mt-2 block h-[5px] w-9 bg-black" aria-hidden />
      {sub && <div className="mt-3 text-xs font-light text-stone-700">{sub}</div>}
    </div>
  );
}

/* Full-bleed colour band (teal / yellow / mint / purple / grey) for page headers and stat rows. */
const bandTones = { teal: 'bg-brand-teal text-white', yellow: 'bg-brand-yellow text-white', mint: 'bg-brand-mint text-white', purple: 'bg-brand-purple text-white', grey: 'bg-brand-grey text-black', white: 'bg-white text-black' };
export function Band({ tone = 'teal', className = '', inner = '', children }) {
  return (
    <section className={`${bandTones[tone]} ${className}`}>
      <div className={`mx-auto max-w-6xl px-8 ${inner}`}>{children}</div>
    </section>
  );
}

export function Progress({ value, total }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200">
        <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-24 text-right text-xs tabular-nums text-stone-500">{value}/{total} · {pct}%</span>
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-white/50 p-10 text-center">
      <div className="font-medium">{title}</div>
      {children && <div className="mt-1 text-sm text-stone-500">{children}</div>}
    </div>
  );
}

export function Kbd({ children }) {
  return <kbd className="rounded border border-stone-300 bg-stone-50 px-1 font-mono text-[10px] text-stone-500">{children}</kbd>;
}
