import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

/* Shows where reviews are stored and lets the user pick another folder. Used in the setup guide and
   in the review settings. The server writes reviewhub.config.json and switches immediately; with "copy"
   the current reviews are copied over (the originals stay where they are). */

export const CLOUD_EXAMPLES = [
  ['Google Drive (Mac)', '~/Library/CloudStorage/GoogleDrive-you@example.org/My Drive/ReviewHub'],
  ['Google Drive (Windows)', 'G:\\My Drive\\ReviewHub'],
  ['OneDrive / Dropbox', '~/OneDrive/ReviewHub  ·  ~/Dropbox/ReviewHub'],
];

export default function WorkspaceEditor({ onChanged, compact = false }) {
  const [info, setInfo] = useState(null);
  const [count, setCount] = useState(0);
  const [value, setValue] = useState('');
  const [copy, setCopy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = () => {
    api.info().then((i) => { setInfo(i); setValue(i.workspace); }).catch(() => {});
    api.listReviews().then((l) => setCount(l.length)).catch(() => {});
  };
  useEffect(load, []);

  async function apply(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await api.setWorkspace(value.trim(), copy && count > 0);
      if (r.unchanged) setMsg({ ok: true, text: 'That is already the current folder.' });
      else setMsg({ ok: true, text: `Now using ${r.workspace}.${r.copied ? ` Copied ${r.copied} review${r.copied === 1 ? '' : 's'}; the originals are still in ${r.previous}.` : ''}` });
      load();
      onChanged?.(r);
    } catch (err) {
      setMsg({ ok: false, text: err.body?.error || err.message });
    } finally { setBusy(false); }
  }

  if (!info) return <div className="text-sm text-stone-500">Loading…</div>;
  if (info.storage === 'cloud') {
    return (
      <div className="space-y-3">
        <div className="bg-stone-100 px-4 py-3 text-[13px]">{info.workspace}{count ? <span className="ml-2 text-xs text-stone-500">· {count} review{count === 1 ? '' : 's'}</span> : null}</div>
        <p className="text-sm text-stone-600">
          This is the hosted ReviewHub: reviews are stored in its cloud database, shared by everyone with the password.
          To work on a review locally, use <code>rh pull</code> and <code>rh push</code> in a local copy (see <code>docs/HOSTING.md</code>).
        </p>
      </div>
    );
  }
  const changed = value.trim() && value.trim() !== info.workspace;

  return (
    <div className="space-y-3">
      <div className="break-all bg-stone-100 px-4 py-3 font-mono text-[13px]">
        {info.workspace}
        <span className="ml-2 font-sans text-xs text-stone-500">
          ({/^default/.test(info.source) ? 'default' : `set by ${info.source}`}{count ? ` · ${count} review${count === 1 ? '' : 's'}` : ''})
        </span>
      </div>

      {!info.configurable ? (
        <p className="text-sm text-stone-600">
          This folder is fixed by the <code>{info.lockedBy}</code> environment variable. Remove it and restart to choose a folder here.
        </p>
      ) : (
        <form onSubmit={apply} className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-stone-500">Store my reviews in</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              spellCheck={false}
              className="mt-1 w-full border border-stone-300 bg-white px-3 py-2 font-mono text-[13px] focus:border-black focus:outline-none"
              placeholder="~/Research/ReviewHub"
            />
          </label>
          {!compact && (
            <div className="text-xs text-stone-500">
              A full path; <code>~</code> means your home folder. Any folder works, including a synced cloud folder, for example:
              <ul className="mt-1 space-y-0.5">
                {CLOUD_EXAMPLES.map(([l, p]) => <li key={l}><span className="text-stone-600">{l}:</span> <code className="break-all">{p}</code></li>)}
              </ul>
            </div>
          )}
          {count > 0 && changed && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} className="mt-1" />
              <span>Copy my {count} existing review{count === 1 ? '' : 's'} to the new folder <span className="text-stone-500">(the originals stay where they are)</span></span>
            </label>
          )}
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy || !changed} className="bg-black px-4 py-2 text-sm font-medium text-white enabled:hover:bg-brand-teal disabled:bg-stone-300">
              {busy ? 'Saving…' : 'Use this folder'}
            </button>
            <span className="text-xs text-stone-500">Saved in <code>reviewhub.config.json</code>, takes effect immediately.</span>
          </div>
        </form>
      )}
      {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.text}</p>}
    </div>
  );
}
