# ReviewHub: instructions for Claude Code

ReviewHub is a local web app for literature reviews (scoping, systematic, rapid). React + Tailwind front end in `src/`, a small Express API in `server/` that reads and writes JSON files in the **workspace**, and a CLI in `scripts/rh.mjs` that works on the workspace files directly (no server needed).

People will open Claude Code here for three kinds of jobs. Work out which one they mean.

1. **Setting up or running ReviewHub** (most users are researchers, not developers)
2. **Acting as an agent reviewer** in one of their reviews
3. **Developing ReviewHub** itself

User docs: `README.md`, `docs/TUTORIAL.md`, `docs/DATA.md`. Point people there rather than repeating them at length.

---

## 1. Setting up and running

Assume the user may not know a terminal well. Explain each step in one plain sentence, and ask before installing anything system-wide.

1. **Node**: `node -v` must be ≥ 20. If missing or too old, suggest the LTS from nodejs.org (or `brew install node` on macOS). Do not install it without asking.
2. **Dependencies**: `npm install` in the project folder.
3. **Workspace**: ask where they want their review data: any folder, e.g. their research storage or a synced cloud folder (Google Drive for desktop, OneDrive, Dropbox, Nextcloud; the folder must be on disk and "available offline", not web-only). Default is `./workspace` (gitignored). Either write `reviewhub.config.json` (copy of `reviewhub.config.example.json`) with `{"workspace": "<full path>"}` (`~` allowed; on Windows use forward slashes), or, once the app runs, let them pick it in the setup guide or under *settings* (that can also copy existing reviews; it calls `PUT /api/workspace`). `REVIEWHUB_WORKSPACE` overrides the config. Never put the workspace inside a folder that is committed to git. If `./data/reviews` exists, that is a legacy workspace and is used automatically: do not move it without asking.
4. **Start**: `npm run dev`. It prints the address to open (default http://localhost:5287, API on 5288). It keeps running; tell the user to keep that terminal open, or start it in the background and give them the printed URL. If the port is taken, ReviewHub is probably already running.
5. **Check**: `node scripts/rh.mjs info` prints the workspace in use and the reviews in it (`list` for a table of reviews).

Never delete or overwrite anything in the workspace during setup.

**Hosted version.** If the user works with the hosted ReviewHub (Vercel), reviews live online. To work on one locally (including as an agent reviewer), `node scripts/rh.mjs pull <review>` first and `node scripts/rh.mjs push <review>` when done; never pass `--force` to `pull` without asking, it replaces unpushed local work (a snapshot is kept). Details: `docs/HOSTING.md`. Removing things is done in the app, which moves them to `<workspace>/trash/`.

---

## 2. Acting as an agent reviewer

You can screen (and code) records as an **LLM/agent reviewer**. Your decisions are compared with the human reviewers' but never become final on their own. Be careful and conservative, and make your reasoning fully traceable.

### Rules

- Work **only through `scripts/rh.mjs`**. Do not edit `review.json` or any `decisions/*.json` by hand.
- Write **only your own** reviewer's decisions. Never touch a human reviewer's file, consensus entries, criteria, or the protocol.
- Shared changes (e.g. proposing codebook entries) only via the CLI commands meant for them, and only when the user asked.
- Judge **only against the review's criteria** as they are written. If a criterion is ambiguous, say so in the rationale and lean towards *fulltext* (title/abstract) rather than *exclude*.
- Use only the information you are given (title, abstract, keywords; at full text the PDF pages). Do not use outside knowledge about a paper to decide.
- Record the model, and a prompt version you increment whenever you change how you judge.

### Workflow

`npm run rh -- <command>` is the same as `node scripts/rh.mjs <command>`. Run it without arguments for help.

```bash
node scripts/rh.mjs show <review>                       # protocol, criteria (codes + hash), reviewers, codebook, charting form, progress
node scripts/rh.mjs add-reviewer <review> --name "Claude (agent)" --model "<model id>"   # LLM reviewer by default; prints its id
node scripts/rh.mjs pool <review> --reviewer "Claude (agent)" --stage ta --limit 50     # JSONL: pending records to judge
# judge each record, write one JSON object per line to a file (format below)
node scripts/rh.mjs decide <review> --reviewer "Claude (agent)" --stage ta --file decisions.jsonl --model "<model id>" --prompt-version v1 --dry-run
node scripts/rh.mjs decide <review> --reviewer "Claude (agent)" --stage ta --file decisions.jsonl --model "<model id>" --prompt-version v1
```

`<review>` is the review id or a unique fragment of its title; `--reviewer` takes an id or the name. `pool` returns only pending records unless `--all`. Work in batches (e.g. 50): run with `--dry-run` first, then for real, check the output, and report progress to the user. One invalid line aborts the whole write (fix it, or use `--allow-partial` deliberately). Use `--scope calibration` to take part in the calibration round. Keep batch files in a temporary folder, not in the project.

One line per record in the decisions file:

```json
{"recordId":"rec_...","decision":"include|fulltext|exclude","criteria":[{"code":"IC1","met":"yes|no|unclear","evidence":"short quote","location":"title|abstract|p. 4"}],"reason":"EC2","confidence":0.8,"rationale":"One or two sentences: how the criteria led to the decision.","note":"","inputs":"what you read, e.g. title+abstract"}
```

- `reason` is the code of the primary exclusion criterion; required for `exclude` at full text, recommended at title/abstract.
- At full text (`--stage ft`) the decisions are `include | exclude | not_retrieved`.
- Criteria with `met: "yes"` are recorded as ticked.
- `confidence` is 0–1. Below about 0.6, prefer `fulltext` at title/abstract.

The CLI validates each line, appends the run and every decision to `agent-logs/<rid>/<runId>.jsonl`, and writes the decisions into your reviewer file, tagged with a hash of the current criteria. If the criteria change later, the UI flags your old decisions. When done, tell the user to reload the browser tab and open *Compare & consensus* to see your decisions and reasoning next to theirs.

**Coding** works the same way: `pool --stage coding`, then `node scripts/rh.mjs code <review> --reviewer <r> --file coding.jsonl`, one line per source:

```json
{"recordId":"rec_...","codes":["Human oversight"],"fields":{"Methodology / methods":"Empirical: qualitative"},"excerpts":[{"text":"...","page":4,"codes":["Human oversight"]}],"rationale":"...","confidence":0.8,"note":""}
```

Codes and fields may be given by label or id; field values must fit the charting form (`show` lists fields, types and options).

**Codebook proposals** (only when asked): `node scripts/rh.mjs codebook <review> --import codebook.json --by "Claude (agent)"`, with `{"codes":[{"group","label","definition","whenToUse","whenNotToUse","example","origin"}]}`. Codes are added, never removed, and the change is logged.

**Paper data**: `node scripts/rh.mjs paper <review>` writes `exports/paper-data.json` (final values for all figures; see `docs/DATA.md`). `docs/examples/figures.py` builds figures from it.

### Reporting

When the user asks how to describe the agent in the paper, base it on the facts in the logs: model, prompt versions, stages and record counts, agreement with humans (*Compare & consensus* or the agreement export), and that all final decisions were made by human reviewers.

---

## 3. Developing ReviewHub

```bash
npm run dev      # API with node --watch + Vite dev server
npm run build    # production build into dist/
```

**Layout**

- `server/app.js`: API routes, independent of storage; `server/index.js`: local entry (file store); `api/index.js`: Vercel entry (cloud store).
- `server/store-fs.js`: workspace files; `server/store-cloud.js` + `server/cloud-db.js`: hosted storage (Neon Postgres for JSON, private Vercel Blob for PDFs/imports); `server/auth.js`: shared password (`REVIEWHUB_PASSWORD`). Both stores implement the same interface; keep them in step.
- `server/workspace.js`: workspace resolution (env → config → legacy `./data` → `./workspace`).
- `scripts/cloud-sync.mjs`: `rh cloud-list | pull | push` between the hosted version and the local workspace. See `docs/HOSTING.md`.
- `src/lib/model.js`: data model, final-decision logic, pools; `src/lib/methods.js`: method profiles (review types, frameworks, charting templates, appraisal tools); `src/lib/prisma.js`: PRISMA counts; `src/lib/progress.js`: step completion, shared by sidebar and overview; `src/lib/analysis.js`: evidence maps and networks; `src/lib/store.jsx`: client state and saving.
- `src/pages/*`: one page per sidebar step; `src/components/*`: shared UI.

**Conventions**

- **Data safety first.** Saves are atomic, shared state is protected by `rev` (409 on conflict), each reviewer writes only their own decision file, and nothing is hard-deleted (trash). Keep it that way. Any schema change needs a migration in `server/index.js` that takes a backup first.
- **Final values are derived, never stored**: consensus → agreeing human reviewers → conflict. LLM/agent reviewers never count. Use the helpers in `model.js` (`finalDecision`, `finalCoding`, `finalField`, `finalAppraisal`) instead of re-implementing this.
- Methodology wording belongs in `methods.js` profiles, not hard-coded in pages.
- House style: black top bar, flat brand colour blocks (`brand-teal/yellow/mint/purple`), square corners, Roboto, lowercase bold titles with the short bar (`brand-bar`). Navigation inside a review lives only in the left sidebar; the top bar is for the review switcher, save status and the active reviewer.
- User data never goes into the repository: `data/`, `workspace/` and `reviewhub.config.json` are gitignored.
- Run `npm run build` before declaring UI work done, and check the change in the browser.
