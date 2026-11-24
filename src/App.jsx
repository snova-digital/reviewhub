import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { reviewStages } from './lib/progress.js';
import { ReviewProvider, useReview } from './lib/store.jsx';
import ReviewsPage from './pages/ReviewsPage.jsx';
import OverviewPage from './pages/OverviewPage.jsx';
import ProtocolPage from './pages/ProtocolPage.jsx';
import SearchesPage from './pages/SearchesPage.jsx';
import RecordsPage from './pages/RecordsPage.jsx';
import ScreeningTA from './pages/ScreeningTA.jsx';
import ExportPage from './pages/ExportPage.jsx';
import ReviewersPage, { ReviewerGate } from './pages/ReviewersPage.jsx';
import ComparePage from './pages/ComparePage.jsx';
import TopBar from './components/TopBar.jsx';
import { LockStatus, StartChoice, WorkGate } from './components/PlanLock.jsx';
import { useScope } from './components/Screening.jsx';

const ScreeningFT = lazy(() => import('./pages/ScreeningFT.jsx'));
const CodingPage = lazy(() => import('./pages/CodingPage.jsx'));
const AppraisalPage = lazy(() => import('./pages/AppraisalPage.jsx'));
const ResultsPage = lazy(() => import('./pages/ResultsPage.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));
const WelcomePage = lazy(() => import('./pages/WelcomePage.jsx'));

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ReviewsPage />} />
      <Route path="/welcome" element={<Suspense fallback={null}><WelcomePage /></Suspense>} />
      <Route path="/r/:id" element={<ReviewShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="protocol" element={<ProtocolPage />} />
        <Route path="searches" element={<SearchesPage />} />
        <Route path="records" element={<RecordsPage />} />
        <Route path="screen/ta" element={<ScreeningGate stage="ta"><ScreeningTA /></ScreeningGate>} />
        <Route path="screen/ft" element={<ScreeningGate stage="ft"><ScreeningFT /></ScreeningGate>} />
        <Route path="code" element={<WorkGate><CodingPage /></WorkGate>} />
        <Route path="appraise" element={<WorkGate><AppraisalPage /></WorkGate>} />
        <Route path="results" element={<ResultsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="compare" element={<WorkGate allowBeforeStart><ComparePage /></WorkGate>} />
        <Route path="reviewers" element={<ReviewersPage />} />
        <Route path="export" element={<ExportPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

// Screening needs a started review with no unresolved plan changes. Before the start, title/abstract screening
// shows the choice between an optional calibration round and the full review.
function ScreeningGate({ stage, children }) {
  const [scope] = useScope();
  return <WorkGate scope={scope} beforeStart={stage === 'ta' ? <StartChoice /> : null}>{children}</WorkGate>;
}

function ReviewShell() {
  const { id } = useParams();
  return (
    <ReviewProvider id={id} key={id}>
      <ReviewLayout />
    </ReviewProvider>
  );
}

/* Left column: the only navigation inside a review. One flat list: overview and reviewers, then the
   review steps in order, with light group labels and a tick once a step is complete. */
const GROUPS = [
  { key: 'plan', label: 'Plan', color: 'yellow' },
  { key: 'screening', label: 'Screening', color: 'mint' },
  { key: 'analysis', label: 'Analysis', color: 'purple' },
];
const BORDER = { teal: 'border-brand-teal', yellow: 'border-brand-yellow', mint: 'border-brand-mint', purple: 'border-brand-purple' };
const DOT = { yellow: 'bg-brand-yellow', mint: 'bg-brand-mint', purple: 'bg-brand-purple' };

function Sidebar() {
  const { review } = useReview();
  const { steps, current } = useMemo(() => reviewStages(review), [review]);
  const link = (color) => ({ isActive }) =>
    `flex items-center gap-3 border-l-4 px-4 py-2 text-[14px] lowercase ${isActive ? `${BORDER[color]} bg-stone-100 font-bold text-black` : 'border-transparent text-stone-800 hover:bg-stone-100 hover:text-black'}`;
  let n = 0;

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-stone-200 bg-white">
      {/* After a mouse click, release focus from the link: otherwise the screening shortcuts (I/E/F, Enter)
          switch the browser to keyboard mode and draw a focus outline around the sidebar entry. */}
      <nav className="flex-1 py-4" onClick={(e) => { if (e.detail > 0) e.target.closest('a')?.blur(); }}>
        <LockStatus />
        <NavLink to="" end className={link('teal')}>
          <span className="flex h-5 w-5 items-center justify-center text-stone-400" aria-hidden>◎</span>overview
        </NavLink>
        <NavLink to="reviewers" className={link('teal')}>
          <span className="flex h-5 w-5 items-center justify-center text-stone-400" aria-hidden>◉</span>reviewers
        </NavLink>
        <NavLink to="settings" className={link('teal')}>
          <span className="flex h-5 w-5 items-center justify-center text-stone-400" aria-hidden>⚙</span>settings
        </NavLink>
        {GROUPS.map((g) => (
          <div key={g.key}>
            <div className="mt-5 flex items-center gap-2 px-5 pb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-stone-500">
              <span className={`h-2 w-2 ${DOT[g.color]}`} aria-hidden />{g.label}
            </div>
            {steps.filter((s) => s.group === g.key).map((s) => {
              n += 1;
              const isCurrent = s === current;
              return (
                <NavLink key={s.to} to={s.to} className={link(g.color)} title={s.detail}>
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${s.done ? 'bg-black text-white' : isCurrent ? 'border-2 border-black text-black' : 'border border-stone-300 text-stone-500'}`}>
                    {s.done ? '✓' : n}
                  </span>
                  <span className="flex-1">{s.label}</span>
                  {s.attention > 0
                    ? <span className="text-[11px] font-normal text-rose-600">{s.attention} open</span>
                    : !s.done && s.progress?.total > 0 && s.key !== 'protocol' && <span className="text-[11px] font-normal tabular-nums text-stone-400">{s.progress.value}/{s.progress.total}</span>}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function SaveStatus() {
  const { status, reload } = useReview();
  const map = {
    saved: ['bg-emerald-400', 'Saved'],
    pending: ['bg-amber-400', 'Unsaved…'],
    saving: ['bg-amber-400 animate-pulse', 'Saving…'],
    error: ['bg-rose-500', 'Save failed: is the API running?'],
    conflict: ['bg-rose-500', 'Changed elsewhere'],
  };
  const [dot, label] = map[status];
  return (
    <span className="flex items-center gap-2" title={status === 'saved' ? 'Saved to review.json' : label}>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
      {status === 'conflict' && <button onClick={reload} className="underline hover:text-white">reload</button>}
    </span>
  );
}

/* Who this browser is reviewing as. Read-only here: the reviewer is chosen on the start page. */
function CurrentReviewer() {
  const { reviewer } = useReview();
  if (!reviewer) return null;
  return (
    <>
      <span className="mx-4 h-5 w-px bg-white/40" aria-hidden />
      <span className="flex items-center gap-2" title="To review as someone else, choose the reviewer on the start page">
        <span className="font-light text-white/60">reviewing as</span>
        <span className="font-medium text-white">{reviewer.name}</span>
        {reviewer.type === 'llm' && <span className="text-xs text-brand-teal">LLM</span>}
      </span>
    </>
  );
}

function ReviewLayout() {
  const { review, error, reviewer } = useReview();
  // <main> is the scroll container: start every page at the top when the route changes.
  const mainRef = useRef(null);
  const { pathname } = useLocation();
  useEffect(() => { mainRef.current?.scrollTo(0, 0); }, [pathname]);
  if (error) return <div className="p-10 text-rose-700">Could not load review: {error.message}</div>;
  if (!review) return <div className="p-10 text-stone-500">Loading…</div>;
  return (
    <div className="flex h-full flex-col">
      <TopBar review={review} right={<><SaveStatus /><CurrentReviewer /></>} />
      <div className="flex min-h-0 flex-1">
        {reviewer && <Sidebar />}
        <main ref={mainRef} className="min-w-0 flex-1 overflow-auto">
          {reviewer
            ? <Suspense fallback={<div className="p-10 text-stone-500">Loading…</div>}><Outlet /></Suspense>
            : <ReviewerGate />}
        </main>
      </div>
    </div>
  );
}
