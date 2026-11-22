import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar.jsx';
import WorkspaceEditor from '../components/WorkspaceEditor.jsx';

/* First-run setup guide. Shown automatically once (empty workspace, not yet dismissed in this browser),
   and reachable any time via /welcome ("setup guide" on the start page). */

export const WELCOMED_KEY = 'reviewhub:welcomed';
export const wasWelcomed = () => { try { return !!localStorage.getItem(WELCOMED_KEY); } catch { return true; } };
const markWelcomed = () => { try { localStorage.setItem(WELCOMED_KEY, new Date().toISOString()); } catch { /* private mode */ } };

function Code({ children }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(children).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  return (
    <div className="group relative mt-3 bg-black px-4 py-3 font-mono text-[13px] leading-relaxed text-white">
      <pre className="overflow-x-auto whitespace-pre">{children}</pre>
      <button type="button" onClick={copy} className="absolute right-2 top-2 px-2 py-0.5 text-xs text-white/60 hover:text-white">
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  );
}

const TONES = ['bg-brand-teal', 'bg-brand-yellow', 'bg-brand-mint', 'bg-brand-purple', 'bg-brand-teal', 'bg-brand-yellow'];

function Step({ n, title, children }) {
  return (
    <section className="grid grid-cols-[3.5rem_1fr] bg-white">
      <div className={`flex items-start justify-center pt-6 text-2xl font-black text-white ${TONES[(n - 1) % TONES.length]}`}>{n}</div>
      <div className="min-w-0 px-7 py-6">
        <h2 className="text-xl font-bold">{title}</h2>
        <div className="mt-2 space-y-2 text-[15px] font-light leading-relaxed text-stone-800">{children}</div>
      </div>
    </section>
  );
}

export default function WelcomePage() {
  const nav = useNavigate();
  const start = () => { markWelcomed(); nav('/'); };

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="min-h-0 flex-1 overflow-auto">
        <section className="bg-brand-teal text-white">
          <div className="mx-auto max-w-4xl px-8 pb-14 pt-14">
            <div className="text-sm font-light text-white/90">welcome</div>
            <h1 className="brand-bar mt-1 text-5xl font-bold">set up ReviewHub</h1>
            <p className="mt-8 max-w-2xl text-lg font-light leading-relaxed">
              Six short steps, about five minutes. You can come back to this guide any time from the start page.
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-4xl space-y-4 px-8 py-12">
          <Step n={1} title="ReviewHub is running">
            <p>
              You are looking at it. It runs on your own computer, at <code>{window.location.host}</code> in this browser, for as long
              as the terminal where you started it stays open. Nothing is sent anywhere.
            </p>
            <p>Stop it with <b>Ctrl + C</b> in that terminal. To start it again later, open a terminal in the ReviewHub folder:</p>
            <Code>npm run dev</Code>
            <p className="text-sm text-stone-600">
              The terminal prints the address to open. To update: <code>git pull</code>, then <code>npm install</code>, then start again.
              Your data is not touched by updates.
            </p>
          </Step>

          <Step n={2} title="choose where your data lives">
            <p>
              All reviews are stored as plain files in one folder, the <b>workspace</b>. Pick a folder that is backed up, for example in
              your research or university storage, or a synced cloud folder (Google Drive, OneDrive, Dropbox, Nextcloud) to share it with a co-reviewer.
            </p>
            <WorkspaceEditor />
            <p className="text-sm text-stone-600">
              Backups are taken automatically and nothing is ever hard-deleted. You can change the folder later under <i>settings</i> in any review.
            </p>
          </Step>

          <Step n={3} title="create your review and say who you are">
            <p>
              On the start page, enter a title and pick the review type (scoping, systematic, rapid). ReviewHub then asks
              <b> who is reviewing</b>: create yourself as a reviewer. The left sidebar walks you through every step, from protocol
              to export, and the overview always shows what to do next.
            </p>
          </Step>

          <Step n={4} title="bring in your co-reviewer">
            <p>Reviewers screen independently and only see their own decisions. Two ways to work together:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li><b>Shared folder:</b> share the workspace folder (e.g. in Google Drive or OneDrive), both choose it in step 2 and pick themselves on the start page (<i>reviewing as</i>, or <i>+ new reviewer</i>). Each reviewer writes only their own file.</li>
              <li><b>Separate computers:</b> each exports their reviewer file on the <i>Reviewers</i> page and sends it; the other imports it.</li>
            </ul>
            <p>Agreement (Cohen&rsquo;s κ) and disagreements appear under <i>Compare &amp; consensus</i>.</p>
          </Step>

          <Step n={5} title="optional: let Claude Code help">
            <p>
              If you use <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer" className="underline">Claude Code</a>,
              open a terminal in the ReviewHub folder and start it:
            </p>
            <Code>claude</Code>
            <p>It reads the project&rsquo;s instructions and can, for example:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li><i>&ldquo;Move my workspace to my research folder and restart ReviewHub.&rdquo;</i></li>
              <li><i>&ldquo;Screen the pending title/abstract records of my review as an agent reviewer.&rdquo;</i></li>
              <li><i>&ldquo;Make a figure of sources per year from the paper data.&rdquo;</i></li>
            </ul>
            <p className="text-sm text-stone-600">AI reviewers log their reasoning for every decision and are compared with the humans, but never decide on their own.</p>
          </Step>

          <Step n={6} title="get your results into the paper">
            <p>
              The <i>Export</i> page has the PRISMA counts, agreement report, search-strategy appendix and CSVs. <b>Paper data (JSON)</b> collects
              all final numbers in one file, so every figure and table in your paper comes from the same snapshot:
            </p>
            <Code>{'npm run rh -- paper "my review title"\npython docs/examples/figures.py <workspace>/reviews/<id>/exports/paper-data.json figures/'}</Code>
          </Step>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-6">
            <p className="text-sm font-light text-stone-600">
              The full tutorial is in the ReviewHub folder: <code>docs/TUTORIAL.md</code>.
            </p>
            <div className="flex items-center gap-4">
              <Link to="/" onClick={markWelcomed} className="text-sm text-stone-600 underline-offset-2 hover:underline">skip</Link>
              <button type="button" onClick={start} className="bg-black px-6 py-3 font-medium text-white hover:bg-brand-teal">
                start my first review →
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
