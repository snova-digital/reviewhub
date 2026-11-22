// Review state: held in memory, changes are written back via the API.
// The shared part (protocol, records, reviewers, consensus, codebook) goes to review.json; each reviewer's
// decisions (review.decisions[reviewerId]) go to their own file, so two reviewers never overwrite each other.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { decisionsOf, reviewerById } from './model.js';

const Ctx = createContext(null);
const SKIP = new Set(['decisions', 'rev', 'updatedAt']);

function sharedChanged(a, b) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!SKIP.has(k) && a[k] !== b[k]) return true;
  return false;
}

// Which reviewer this browser acts as, per review. Chosen on the start page (or on first entry to a review).
const meKey = (id) => `reviewhub:${id}:reviewer`;
export const readMe = (id) => { try { return localStorage.getItem(meKey(id)) || null; } catch { return null; } };
export const writeMe = (id, rid) => {
  try { if (rid) localStorage.setItem(meKey(id), rid); else localStorage.removeItem(meKey(id)); } catch { /* private mode */ }
};

export function ReviewProvider({ id, children }) {
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('saved'); // saved | pending | saving | error | conflict
  const [me, setMeState] = useState(() => readMe(id));
  const latest = useRef(null);
  const saved = useRef(null); // last state known to be on disk
  const timer = useRef(null);
  const inflight = useRef(Promise.resolve());

  const load = useCallback(async () => {
    const r = await api.getReview(id);
    r.decisions ||= {};
    latest.current = r; saved.current = r; setReview(r); setStatus('saved');
  }, [id]);

  useEffect(() => { load().catch(setError); }, [load]);

  const persist = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    inflight.current = inflight.current.then(async () => {
      const snap = latest.current;
      const base = saved.current;
      if (!snap || snap === base) return;
      setStatus('saving');
      try {
        if (sharedChanged(snap, base)) {
          const { decisions: _d, ...shared } = snap;
          const { rev, updatedAt } = await api.saveReview(shared);
          latest.current = { ...latest.current, rev, updatedAt };
          saved.current = { ...snap, rev, updatedAt, decisions: saved.current.decisions };
        }
        for (const [rid, d] of Object.entries(snap.decisions || {})) {
          if (d === base.decisions?.[rid]) continue;
          const { rev, updatedAt } = await api.saveDecisions(id, rid, d);
          const bumped = { ...d, rev, updatedAt };
          const cur = latest.current.decisions[rid];
          latest.current = { ...latest.current, decisions: { ...latest.current.decisions, [rid]: cur === d ? bumped : { ...cur, rev, updatedAt } } };
          saved.current = { ...saved.current, decisions: { ...saved.current.decisions, [rid]: cur === d ? bumped : { ...d, rev, updatedAt } } };
        }
        for (const rid of Object.keys(base.decisions || {})) {
          if (snap.decisions?.[rid]) continue;
          await api.deleteDecisions(id, rid);
          const { [rid]: _x, ...rest } = saved.current.decisions;
          saved.current = { ...saved.current, decisions: rest };
        }
        setReview(latest.current);
        setStatus(timer.current ? 'pending' : 'saved');
      } catch (e) {
        setStatus(e.status === 409 ? 'conflict' : 'error');
        console.error(e);
      }
    });
    return inflight.current;
  }, [id]);

  // update(fn) – fn receives the current review state and returns the next one (no mutation).
  const update = useCallback((fn, { immediate = false } = {}) => {
    const next = fn(latest.current);
    latest.current = next;
    setReview(next);
    setStatus('pending');
    clearTimeout(timer.current);
    if (immediate) return persist();
    timer.current = setTimeout(persist, 600);
    return Promise.resolve();
  }, [persist]);

  // updateMine(fn) – change the active reviewer's own decision file.
  const updateMine = useCallback((fn, opts) => update((r) => ({
    ...r, decisions: { ...r.decisions, [me]: fn(decisionsOf(r, me)) },
  }), opts), [update, me]);

  const setMe = useCallback((rid) => {
    writeMe(id, rid);
    setMeState(rid);
  }, [id]);

  useEffect(() => {
    const warn = (e) => { if (timer.current) { persist(); e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [persist]);

  // Pull the latest files from disk (e.g. the co-reviewer's decisions). Saves pending changes first.
  const reload = useCallback(async () => { await persist(); await load(); }, [persist, load]);

  const reviewer = review ? reviewerById(review, me) : null;
  return (
    <Ctx.Provider value={{ review, update, updateMine, status, error, reload, flush: persist, me: reviewer ? me : null, reviewer, setMe }}>
      {children}
    </Ctx.Provider>
  );
}

export const useReview = () => useContext(Ctx);
