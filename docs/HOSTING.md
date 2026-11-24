# Hosting ReviewHub on Vercel

ReviewHub normally runs on your own computer and keeps reviews as files in a folder. It can also run as a website, so a
co-reviewer only needs a browser and a password. Both work from the same code:

| | Local (default) | Hosted (Vercel) |
|---|---|---|
| Start | `npm run dev` | deployed with `vercel deploy --prod` |
| Review data (JSON) | `<workspace>/reviews/<id>/…` | Neon Postgres (one row per file) |
| PDFs, raw import files | `<workspace>/reviews/<id>/pdfs`, `imports` | private Vercel Blob store, same paths |
| Access | only this computer | shared password (`REVIEWHUB_PASSWORD`) |
| Backups | `backups/` folder, every ≤10 min | `rh_backups` table, every ≤10 min, 50 kept |
| Deleting | moved to `trash/` | flagged / moved to `rh_trash`, never removed |

The same rules apply in both: each reviewer writes only their own decisions, shared state is protected by `rev` (a
save from someone who has not seen the latest version is refused, and the app shows *Changed elsewhere · reload*).

## Setup (already done once for this project)

```bash
vercel link                                        # Vercel project
vercel integration add neon --meta region=fra1     # Postgres; sets DATABASE_URL
vercel blob create-store reviewhub-files --access private --region fra1 --yes   # sets BLOB_READ_WRITE_TOKEN
vercel env add REVIEWHUB_PASSWORD production       # the shared password (also for preview)
vercel env add REVIEWHUB_SESSION_SECRET production # any long random string
vercel deploy --prod
```

The database tables are created automatically on first use. To change the password, update `REVIEWHUB_PASSWORD`
and redeploy; everyone is signed out.

## Working locally on a hosted review

For example, to run Claude Code as an agent reviewer on your own machine, or to work offline:

```bash
vercel env pull .env.local          # once: database and Blob credentials for the CLI
node scripts/rh.mjs cloud-list      # reviews stored online
node scripts/rh.mjs pull "<review>" # copy it into your local workspace (incl. PDFs)
npm run dev                         # work locally as usual, and/or use the agent workflow in CLAUDE.md
node scripts/rh.mjs push "<review>" # upload your changes
```

How `push` decides what to upload:

- **Your decisions** (and every other reviewer file you changed): uploaded if that reviewer's decisions were not
  changed online since your pull. Your co-reviewer works in their own decisions, so this normally always goes through.
- **Agent logs, PDFs, import files**: new files and appended log lines are uploaded.
- **`review.json`** (protocol, criteria, reviewers, codebook, consensus, records): uploaded only if nobody changed it
  online since your pull. Otherwise it is reported as a conflict and not uploaded. Then run `rh pull --force`
  (your local copy is snapshotted to the review's `backups/` folder first) and redo the shared change.

Good habit: `pull` right before you start, `push` as soon as you are done, and stop the local app (`npm run dev`)
before pulling or pushing. `pull` refuses to replace local changes that were never pushed, unless you add `--force`.

Sync state is kept per review in `<workspace>/reviews/<id>/.cloud-sync.json`.

## Testing the hosted setup locally

`REVIEWHUB_STORAGE=cloud node server/index.js` (with `.env.local` pulled, and `REVIEWHUB_PASSWORD` set in your shell)
runs the API against the online database, so changes go straight to the hosted data.

## Limits

- A single request to a Vercel Function can carry at most 4.5 MB. Large saves are gzipped by the browser, which
  covers reviews with several thousand records. PDFs and import files bypass the limit: they go straight from the
  browser to Blob storage, and downloads use short-lived signed links.
- Neon's free plan has 0.5 GB of storage, which is plenty for the JSON (PDFs are in Blob).
