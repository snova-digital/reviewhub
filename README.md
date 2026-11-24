<p align="center">
  <img src="public/favicon.svg" width="72" alt="ReviewHub logo: a screening funnel" />
</p>

<h1 align="center">ReviewHub</h1>

<p align="center">
  A local, open tool for running literature reviews end to end: protocol, searches, deduplication,
  independent screening by several reviewers, extraction, appraisal, analysis and PRISMA reporting.
  Everything is stored as plain JSON files on your own computer.
</p>

---

## Why ReviewHub

- **Method-aware.** Scoping reviews (JBI / PRISMA-ScR), systematic reviews (Cochrane / PRISMA 2020), rapid reviews and custom literature reviews. The review type sets the guidance, the reporting guideline and the eligibility framework (PCC, PICO, PICOS, PEO, SPIDER, SPICE or your own).
- **Real multi-reviewer screening.** Each reviewer has their own decision file and only sees their own decisions while screening. Agreement (percent, Cohen's κ) and a consensus step come afterwards. Second reviewers can screen everything or a reproducible random sample.
- **Human and AI reviewers side by side.** LLM or agent reviewers (e.g. Claude Code) screen with a full reasoning log per decision. They are compared with the humans but **never decide on their own**.
- **Transparent and reproducible.** Raw database exports are archived unchanged, decisions keep their history, backups are taken automatically, and nothing is ever hard-deleted.
- **Paper-ready.** Live PRISMA flow diagram, inter-rater agreement report, search-strategy appendix, evidence maps, co-occurrence networks (VOSviewer export) and CSV/JSON exports for your own figures.
- **Local and private.** No accounts, no cloud. The server only listens on your own machine.

## Quick start

You need **Node.js 20 or newer** ([nodejs.org](https://nodejs.org)) and git.

```bash
git clone https://github.com/<your-org>/reviewhub.git
cd reviewhub
npm install
npm run dev
```

Open the address the terminal prints (by default **http://localhost:5287**). On first start, a short setup guide asks where your data should live: any folder you like, including a synced **Google Drive, OneDrive, Dropbox or Nextcloud** folder. You can change it later under *settings*, or by hand in `reviewhub.config.json` (see `reviewhub.config.example.json`). Then create a review, choose who you are reviewing as, and follow the steps in the left sidebar.

### Let Claude Code set it up for you

If you use [Claude Code](https://claude.com/claude-code), open a terminal in the project folder and run:

```bash
claude
```

Then ask, for example: *"Set up ReviewHub for me and start it"*, or *"Screen the pending title/abstract records of my review as an agent reviewer"*. Claude Code reads [`CLAUDE.md`](CLAUDE.md), which tells it how to install, configure the workspace, start the app, and act as a documented agent reviewer.

## Documentation

| | |
|---|---|
| [**Tutorial**](docs/TUTORIAL.md) | Installation, where the data lives, and a complete review from protocol to paper, step by step |
| [**Data format**](docs/DATA.md) | The JSON files on disk, what each field means, and how to build paper figures from them |
| [**CLAUDE.md**](CLAUDE.md) | Instructions for Claude Code: setup, agent reviewing, and development conventions |

## The workflow at a glance

| Step | What you do |
|---|---|
| Settings | Review type, eligibility framework, appraisal on/off, deduplication mode |
| Reviewers | Add human and LLM/agent reviewers and their workload per stage (full or random sample); a lead reviewer manages the plan |
| Start (in step 4) | The lead starts the full review: protocol, criteria and searches are frozen; later changes pause screening until acknowledged as an amendment, undone, or the review is restarted |
| 1 · Protocol & criteria | Objective, questions, framework elements, registration, inclusion / exclusion criteria |
| 2 · Searches & import | One documented search run per database, plus the raw export (RIS, BibTeX, CSV, PubMed, WoS) |
| 3 · Records & duplicates | Automatic deduplication (strict or fuzzy) with manual override, bulk PDF attachment |
| 4 · Title / abstract screening | First the lead chooses: an optional calibration round (random sample; size, search stream) or the full review, which freezes steps 1 and 2. Then include / full text / exclude, keyboard driven |
| 5 · Full-text screening | Embedded PDF viewer, evidence excerpts, exclusion reason required |
| 6 · Extraction & coding | Charting form, codebook with definitions and change log, code excerpts |
| 7 · Critical appraisal | RoB 2, ROBINS-I, CASP or a custom checklist (optional) |
| 8 · Compare & consensus | Agreement and κ per stage, disagreements, consensus decisions |
| 9 · Results & analysis | Evidence maps, co-occurrence networks, charts of the included sources |
| 10 · Export | PRISMA counts, CSVs, agreement report, search appendix, RIS, full JSON |

## Where your data lives

```
<workspace>/
  reviews/<reviewId>/
    review.json                  shared: protocol, searches, records, reviewers, codebook, consensus
    decisions/<reviewerId>.json  one file per reviewer: screening, evidence, coding, appraisal
    agent-logs/<reviewerId>/     reasoning logs of agent reviewers (JSONL, append-only)
    imports/                     raw database exports, verbatim
    pdfs/                        full texts
    backups/                     automatic snapshots (every 10 min while working, last 50 kept)
  trash/                         deleted reviews and removed reviewers, never hard-deleted
```

Back up the workspace folder like any other research data. See [docs/DATA.md](docs/DATA.md) for the details.

## Working with a co-reviewer

- **Shared folder** (e.g. Google Drive, OneDrive, Dropbox, a network drive): share the workspace folder and both choose it in ReviewHub. Each reviewer writes only their own decision file. See [cloud folders](docs/TUTORIAL.md#cloud-folders-google-drive-onedrive-dropbox-nextcloud) for the rules that keep syncing reliable.
- **Different computers:** each reviewer exports their reviewer file (Reviewers page → Export) and the other imports it.

## Development

```bash
npm run dev     # Vite dev server (default :5287) + API with node --watch (default :5288)
npm run build   # production build into dist/
npm start       # serve dist/ and the API from one port (PORT, default 5288)
```

React 18 + Tailwind CSS 4 front end (`src/`), a small Express API (`server/`) that reads and writes the workspace, and a command-line helper (`scripts/rh.mjs`) for scripted and agent access. Set `HOST=0.0.0.0` only if you really want the app reachable from other machines: there is no login.

## Citing ReviewHub

If ReviewHub helped your review, please cite it and report it in your methods section (e.g. *"Screening and data charting were managed in ReviewHub (version x.y)"*). A `CITATION.cff` will follow with the first release.

## License

To be decided before the first public release.
