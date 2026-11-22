import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { newReview, REVIEW_TYPES } from '../lib/model.js';
import TopBar from '../components/TopBar.jsx';
import { readMe, writeMe } from '../lib/store.jsx';
import { wasWelcomed } from './WelcomePage.jsx';

export default function ReviewsPage() {
  const [reviews, setReviews] = useState(null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('scoping');
  const [err, setErr] = useState(null);
  const nav = useNavigate();

  const [info, setInfo] = useState(null);
  useEffect(() => {
    api.listReviews().then((list) => {
      // First run ever (empty workspace, guide never dismissed in this browser): show the setup guide first.
      if (list.length === 0 && !wasWelcomed()) { nav('/welcome', { replace: true }); return; }
      setReviews(list);
    }).catch(setErr);
    api.info().then(setInfo).catch(() => {});
  }, [nav]);

  async function create(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const r = await api.createReview(newReview({ title: title.trim(), type }));
    nav(`/r/${r.id}/protocol`);
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="min-h-0 flex-1 overflow-auto">
      {/* Hero: teal statement block meeting a yellow "new review" block, joined by the Arrow tab */}
      <section className="grid md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="relative bg-brand-teal text-white">
          <div className="ml-auto max-w-[44rem] px-8 py-20 md:pr-20">
            <h1 className="brand-bar text-5xl font-bold">ReviewHub</h1>
            <p className="mt-8 max-w-md text-xl font-light leading-relaxed">
              Your literature review from protocol to paper: searches, screening with co-reviewers, extraction and PRISMA-ready results.
            </p>
            <p className="mt-6 text-sm font-light text-white/80">
              Runs locally · plain files · <Link to="/welcome" className="underline underline-offset-2 hover:text-white">setup guide</Link>
            </p>
            {info && <p className="mt-2 max-w-xl break-all font-mono text-xs text-white/60" title="Workspace folder: where your reviews are stored">{info.workspace}</p>}
          </div>
          <span className="brand-notch -right-[1.625rem] top-1/2 z-10 hidden -translate-y-1/2 text-brand-teal md:block" aria-hidden />
        </div>

        <div className="bg-brand-yellow text-white">
          <div className="max-w-[36rem] px-8 py-20 md:pl-20">
            <h2 className="brand-bar text-4xl font-bold">new review</h2>
            <form onSubmit={create} className="mt-10 space-y-6">
              <label className="block">
                <span className="text-sm font-light text-white/90">Title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Remote work and wellbeing: a scoping review"
                  className="mt-1 w-full border-0 border-b-2 border-white/70 bg-transparent px-0 py-2 text-lg text-white placeholder:text-white/70 focus:border-white focus:ring-0 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-sm font-light text-white/90">Type</span>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="mt-1 w-full border-0 border-b-2 border-white/70 bg-transparent px-0 py-2 text-white focus:border-white focus:outline-none [&>option]:text-black"
                >
                  {REVIEW_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <button
                type="submit"
                disabled={!title.trim()}
                className="flex items-center gap-3 bg-black px-6 py-3 font-medium text-white transition enabled:hover:bg-white enabled:hover:text-black disabled:cursor-not-allowed disabled:bg-transparent disabled:text-white/80 disabled:ring-2 disabled:ring-white/70"
              >
                <span className="text-xl leading-none">+</span> create review
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* Existing reviews: card grid news-style */}
      <section className="mx-auto max-w-6xl px-8 py-14">
        <h2 className="brand-bar text-4xl font-bold text-black">reviews</h2>
        <p className="mt-5 max-w-2xl font-light text-stone-700">
          Choose who you are reviewing as for each review. Inside a review this stays fixed, so decisions always land in the right reviewer&rsquo;s file.
        </p>
        {err && <div className="mt-6 text-sm text-rose-700">Cannot reach the API ({err.message}). Start it with <code>npm run dev</code>.</div>}
        {reviews?.length === 0 && <p className="mt-8 font-light text-stone-600">No reviews yet. Create your first one above.</p>}
        <div className="mt-10 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {reviews?.map((r, i) => <ReviewCard key={r.id} r={r} tone={CARD_TONES[i % CARD_TONES.length]} />)}
        </div>
      </section>
      </main>
    </div>
  );
}

/* One review: the coloured header and title open it; the footer picks an existing reviewer
   or starts a new one (which opens the review's reviewer form). */
function ReviewCard({ r, tone }) {
  const nav = useNavigate();
  const [me, setMe] = useState(() => readMe(r.id));
  const reviewers = r.reviewers || [];
  const valid = reviewers.some((rv) => rv.id === me);
  const choose = (rid) => { writeMe(r.id, rid || null); setMe(rid || null); };
  const startNew = () => { choose(null); nav(`/r/${r.id}?reviewer=new`); };
  return (
    <div className="group relative flex flex-col bg-white transition hover:shadow-lg">
      <Link to={`/r/${r.id}`} className="flex flex-1 flex-col">
        <div className={`relative h-24 ${tone.bg}`}>
          <div className="px-8 pt-6 text-sm font-medium lowercase text-white">{r.type} review</div>
          <span className={`brand-notch -bottom-[1.625rem] left-6 ${tone.text}`} aria-hidden />
        </div>
        <div className="flex flex-1 flex-col px-8 pb-4 pt-7">
          <div className="mt-3 text-[22px] leading-snug text-black group-hover:underline">{r.title}</div>
          <div className="mt-auto flex items-center justify-between pt-8 text-sm font-light text-stone-700">
            <span>{r.runs} runs · {r.records} records</span>
            <span>{new Date(r.updatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).toLowerCase()}</span>
          </div>
        </div>
      </Link>
      <div className="space-y-3 border-t border-stone-200 px-8 py-3 text-sm">
        <label className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 font-light text-stone-600">reviewing as</span>
          {reviewers.length ? (
            <select
              value={valid ? me : ''}
              onChange={(e) => choose(e.target.value)}
              className="min-w-0 flex-1 border-0 border-b border-stone-300 bg-transparent py-1 font-medium text-black focus:border-black focus:outline-none"
            >
              {!valid && <option value="" disabled>choose reviewer…</option>}
              {reviewers.map((rv) => <option key={rv.id} value={rv.id}>{rv.name}{rv.type === 'llm' ? ' (LLM)' : ''}</option>)}
            </select>
          ) : (
            <span className="min-w-0 flex-1 font-light text-stone-500">no reviewers yet</span>
          )}
        </label>
        <button
          type="button"
          onClick={startNew}
          className="w-full bg-black px-3 py-2 font-medium text-white transition hover:bg-brand-teal"
        >
          + new reviewer
        </button>
      </div>
    </div>
  );
}

const CARD_TONES = [
  { bg: 'bg-brand-teal', text: 'text-brand-teal' },
  { bg: 'bg-brand-yellow', text: 'text-brand-yellow' },
  { bg: 'bg-brand-mint', text: 'text-brand-mint' },
  { bg: 'bg-brand-purple', text: 'text-brand-purple' },
];
