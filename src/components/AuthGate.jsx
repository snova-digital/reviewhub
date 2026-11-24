import { useEffect, useState } from 'react';
import { api, AUTH_EVENT, SIGNED_IN_EVENT } from '../lib/api.js';
import { LogoMark, Wordmark } from './Logo.jsx';
import { Button, Input } from './ui.jsx';

/* Hosted version only: asks for the shared password before anything else loads. Locally (no password configured)
   the server reports required: false and the app opens straight away. If a session runs out while working, any
   API call answers 401 and this gate comes back; unsaved changes stay in memory and are saved after signing in. */

function LoginPage({ onDone }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.login(password);
      onDone();
    } catch (err) {
      setError(err.body?.error || 'Could not sign in.');
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 bg-black">
        <div className="flex h-[72px] items-center gap-2.5 px-6 text-white">
          <LogoMark className="h-12 w-12 -my-1" />
          <Wordmark />
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center overflow-auto px-4 pt-[12vh]">
        <form onSubmit={submit} className="w-full max-w-sm bg-white">
          <div className="h-1.5 bg-brand-teal" aria-hidden />
          <div className="space-y-5 px-7 py-7">
            <div>
              <h1 className="brand-bar text-2xl font-bold lowercase tracking-tight">sign in</h1>
              <p className="mt-3 text-sm font-light text-stone-600">Enter the password for this ReviewHub.</p>
            </div>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-stone-500">Password</span>
              <Input
                type="password" autoComplete="current-password" autoFocus required
                value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1"
              />
            </label>
            {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
            <Button tone="primary" size="lg" className="w-full" disabled={busy || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

export default function AuthGate({ children }) {
  const [state, setState] = useState('checking'); // checking | in | out | error
  const [everIn, setEverIn] = useState(false);
  useEffect(() => { if (state === 'in') setEverIn(true); }, [state]);

  useEffect(() => {
    api.session()
      .then((s) => setState(!s.required || s.authenticated ? 'in' : 'out'))
      .catch(() => setState('error'));
    const onAuth = () => setState('out');
    window.addEventListener(AUTH_EVENT, onAuth);
    return () => window.removeEventListener(AUTH_EVENT, onAuth);
  }, []);

  if (state === 'checking') return null;
  if (state === 'error') return <div className="p-10 text-rose-700">Could not reach the ReviewHub API. Is it running?</div>;
  return (
    <>
      {/* Children stay mounted while signed out, so in-memory changes survive an expired session. */}
      {state === 'out' && <div className="fixed inset-0 z-50 bg-brand-canvas"><LoginPage onDone={() => { setState('in'); window.dispatchEvent(new Event(SIGNED_IN_EVENT)); }} /></div>}
      {state === 'in' || everIn ? children : null}
    </>
  );
}
