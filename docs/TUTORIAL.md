# ReviewHub tutorial

This tutorial takes you from installation to the figures in your paper. It follows one complete review, step by step, in the order the left sidebar shows.

**Contents**

1. [Install and start](#1-install-and-start)
2. [Where your data lives](#2-where-your-data-lives)
3. [Using Claude Code with ReviewHub](#3-using-claude-code-with-reviewhub)
4. [A complete review, step by step](#4-a-complete-review-step-by-step)
5. [Working with several reviewers](#5-working-with-several-reviewers)
6. [LLM and agent reviewers](#6-llm-and-agent-reviewers)
7. [From the data to your paper](#7-from-the-data-to-your-paper)
8. [Backups, safety and troubleshooting](#8-backups-safety-and-troubleshooting)

---

## 1. Install and start

### Requirements

- **Node.js 20 or newer.** Check with `node -v`. Install from [nodejs.org](https://nodejs.org) (the LTS version) or with your package manager (`brew install node` on macOS).
- **git**, to download the project and receive updates.
- A modern browser (Chrome, Firefox, Safari, Edge).

### Install

```bash
git clone https://github.com/<your-org>/reviewhub.git
cd reviewhub
npm install
```

### Start

```bash
npm run dev
```

This starts the app and prints the address to open in your browser (by default **http://localhost:5287**; the local API behind it uses the next port, 5288). If you run ReviewHub differently, for example with `npm start` after `npm run build`, open whatever address the terminal shows.

The first time, ReviewHub shows a short **setup guide**, where you also choose where your data lives. You can reopen it any time from *setup guide* on the start page. Keep the terminal open while you work; press `Ctrl+C` there to stop ReviewHub. Your work is saved automatically (the top bar shows *Saved*).

### Update

```bash
git pull
npm install
npm run dev
```

Your data is not part of the project folder's tracked files, so updating never touches it. Older reviews are migrated automatically on first load, and a backup is taken before that.

---

## 2. Where your data lives

ReviewHub keeps all reviews in one folder, the **workspace**. Choose it yourself, ideally somewhere that is backed up with your other research data.

**In the app (easiest).** In the setup guide (step 2), or under *settings* in any review, enter a folder and click *Use this folder*. You can optionally copy your existing reviews over (the originals stay where they were). The change takes effect immediately and is saved in `reviewhub.config.json` in the ReviewHub folder.

**By hand.** Create `reviewhub.config.json` in the ReviewHub folder (there is an example, `reviewhub.config.example.json`) and restart:

```json
{ "workspace": "~/Research/ReviewHub" }
```

Use a full path; `~` means your home folder. On Windows, write backslashes twice (`"D:\\Research\\ReviewHub"`) or use forward slashes (`"D:/Research/ReviewHub"`).

If you set nothing, ReviewHub uses `./workspace` inside the program folder (or `./data`, if an older installation already has reviews there). An environment variable `REVIEWHUB_WORKSPACE` overrides everything else; then the folder cannot be changed in the app. The folder in use is shown in the setup guide, under *settings*, and printed in the terminal on start.

### Cloud folders: Google Drive, OneDrive, Dropbox, Nextcloud

Any folder that appears in your file system works, so a synced cloud folder is a good choice, also for sharing the review with a co-reviewer:

| Service | Typical folder |
|---|---|
| Google Drive (Mac, *Google Drive for desktop*) | `~/Library/CloudStorage/GoogleDrive-you@example.org/My Drive/ReviewHub` |
| Google Drive (Windows) | `G:/My Drive/ReviewHub` |
| OneDrive | `~/OneDrive/ReviewHub` (Mac: `~/Library/CloudStorage/OneDrive-…/ReviewHub`) |
| Dropbox | `~/Dropbox/ReviewHub` |
| Nextcloud / university storage | wherever the sync client puts it |

A few rules keep it reliable:

- Use the **desktop sync app** (e.g. *Google Drive for desktop*), not the website: ReviewHub needs the files on your disk.
- Make the folder **available offline** (Google Drive: right-click → *Available offline*, or choose *Mirror files* in its settings), so files are never just placeholders in the cloud.
- **Two reviewers at the same time** is fine for screening and coding, because each reviewer writes only their own file. Shared things (protocol, criteria, codebook, consensus) are best changed by one person at a time: the sync takes a moment, and if both edit at once the sync service may keep two versions. ReviewHub shows *Changed elsewhere → reload* when it notices a newer version.
- Before switching computers, let the sync finish (the sync app shows when everything is up to date).

What is inside a review folder is described in [DATA.md](DATA.md). In short: `review.json` holds everything shared, `decisions/` holds one file per reviewer, and `imports/` and `pdfs/` hold your source files.

---

## 3. Using Claude Code with ReviewHub

[Claude Code](https://claude.com/claude-code) is an AI assistant that works in your terminal. ReviewHub ships with a [`CLAUDE.md`](../CLAUDE.md) file that tells Claude Code how the project works, so you can hand it practical jobs.

### Start Claude Code in the project

```bash
cd reviewhub
claude
```

### Things you can ask

| You say | What Claude Code does |
|---|---|
| *"Set up ReviewHub for me and start it."* | Checks Node, runs `npm install`, asks where you want your data (e.g. a Google Drive folder), writes `reviewhub.config.json`, starts the app |
| *"Where is my data stored, and is it backed up?"* | Reads the workspace configuration and lists your reviews, backups and trash |
| *"Import these three RIS files into my review as Scopus, WoS and IEEE runs."* | Guides you through the Searches page, or checks the files for problems first |
| *"Screen the pending title/abstract records of my review as an agent reviewer."* | Registers itself as an agent reviewer, screens with the command-line helper, and writes a reasoning log for every decision |
| *"Summarise where my review stands."* | Reads the review files and reports progress, open conflicts and what is next |
| *"Make me a figure of sources per year from the paper data."* | Reads the exported paper data and writes a plotting script |

Claude Code asks before it runs commands or changes files. It never edits human reviewers' decisions, and agent decisions never become final on their own: they appear under *Compare & consensus* next to the human ones.

---

## 4. A complete review, step by step

The left sidebar lists every step in order. A ✓ means the step is complete, a bold ring marks the step you are currently on, and numbers like `120/497` show progress. The **Overview** page summarises where the review stands and what to do next.

### 4.0 Create the review and choose who you are

1. On the start page, enter a **title** and pick the **type** (scoping, systematic, rapid, other), then *create review*.
2. ReviewHub asks **Who is reviewing?** Create yourself as a reviewer (human). Leave the workload on *Full review* for now. The first human reviewer of a review becomes its **lead reviewer** (see [section 5](#5-working-with-several-reviewers)).

Your choice is remembered in this browser. To review as someone else, go back to the start page (logo or review switcher in the top bar) and change *reviewing as* on the review's card. Click **+ new reviewer** on the card to add another person.

### 4.1 Settings

Open **settings** in the sidebar and check:

- **Review type**: decides the methodology guidance and the reporting guideline (PRISMA-ScR for scoping reviews, PRISMA 2020 otherwise).
- **Eligibility framework**: PCC (JBI default), PICO, PICOS, PEO, SPIDER, SPICE, or custom elements.
- **Critical appraisal**: on for systematic reviews; usually off for scoping reviews.
- **Deduplication**: *strict* (same DOI or identical title ±1 year) or *fuzzy* (also ≥ 90 % similar titles with matching year and first author).

### 4.2 Protocol & criteria

Fill in the objective, review questions, the framework elements, and the registration (e.g. OSF or PROSPERO). Then write the **inclusion and exclusion criteria**. Each criterion has:

- an element (e.g. *Population*, *Language*, *Date range*), and
- the stages it applies to (title/abstract, full text, or both).

There are three kinds of criteria:

- **Paired** (*+ Add criterion → Paired criterion*): one criterion with an inclusion side and an exclusion side, like a row of an eligibility table (e.g. *Technology: LLMs or generative AI* / *conventional AI without transferable contribution*). While screening you judge it **meets / unclear / fails**; a *fail* becomes the exclusion reason. Use this when inclusion and exclusion are two ends of the same question.
- **Inclusion** and **exclusion**: ticked on their own. Good for simple rules such as *not in English* or *published before 2018*. Inclusion criteria that share a *group* (e.g. RQ1–RQ3) need at least one of the group.

You can switch a criterion's type later. *Fold in exclusion…* turns an existing exclusion criterion into the exclusion side of a paired one; past decisions that ticked it count as *fails*.

Criteria get short codes (EC1, IC1, E1, …) that appear in the checklist while screening, and that the exclusion reasons and κ per criterion refer to. Pilot them with your co-reviewer before screening everything (see 4.5).

**Criteria per search stream.** With search streams switched on (settings), each criterion has an *applies to* choice: *all streams*, or one or more streams (e.g. only RQ2). A record is screened against the shared criteria plus those of every stream that found it; for records found by several streams (duplicates across streams) that is the union. The checklist shows which streams found the record and hides criteria that don't apply. The suggested decision includes a record if it meets the shared criteria and those of at least one of its streams. Agreement per criterion is computed only on the records the criterion applies to. If you need criteria for a single search run, give that run its own stream.

### 4.3 Searches & import

Create one **search run** per database and search session. Record:

- database and platform, date run, date range, fields searched, filters,
- the **exact search string** as you entered it,
- the number of hits the database reported.

Then **import the export file** for that run: RIS, BibTeX (`.bib`), CSV/TSV (Scopus, Web of Science, IEEE), PubMed (`.nbib`) or Web of Science plain text (`.txt`). The raw file is archived unchanged in `imports/`, which is your audit trail. If the number imported differs from the reported hits, check the export (many databases cap exports, e.g. at 1,000 or 2,000 records per file; import several files into the same run).

A run counts as documented once it has a search string **and** at least one imported file. If a run returned nothing, note that in the run's notes.

### 4.4 Records & duplicates

ReviewHub deduplicates automatically. Duplicates are **flagged, not deleted**: you can review every pair and undo false matches. The PRISMA diagram counts them as *duplicates removed*.

Attach PDFs here or later. *Attach PDFs in bulk* matches files by Zotero file path, DOI, or title in the file name. Tip: in Zotero, export the collection with files, or use the *ZotFile*-style naming `Author_Year_Title.pdf`.

### Start the review: freezing the plan

When protocol, criteria and searches are ready, open step 4, **title / abstract screening**. Until the review is started it asks how you want to begin, and only the lead reviewer can choose:

- **Calibration rounds (optional)**: set how many records round 1 uses (JBI suggests about 25–50) and, with search streams switched on, where they come from: all records, **every stream equally (stratified)**, or one stream. Use *stratified* when streams have their own criteria, so each stream's criteria are tested. ReviewHub draws a **random sample** once, when the round starts; every reviewer screens that same set (see 4.5). The draw is reproducible (its seed is stored) and later imports never change it. Steps 1 and 2 stay editable during calibration.
- **Another round after changing the criteria**: the lead clicks *Start round 2…* (in this card or under *Compare & consensus → Calibration*) and says what changed. Round 1 is closed with its agreement results and the criteria as they were, everyone's round 1 decisions are archived (a backup is taken first), and round 2 draws **fresh records** that were not in any earlier round. Every round, with its sample, agreement, κ and the reason for the next round, stays listed, and is included in the paper data (`protocol.calibrationRounds`).
- **Full review**: a checklist shows what is ready, and a warning explains that starting **freezes the current state of step 1 (protocol & criteria) and step 2 (searches & import)**, together with the method settings (review type, framework, appraisal, deduplication). The lead confirms this explicitly, and main screening opens for everyone.

You can run a calibration round first and start the full review afterwards, or skip calibration.

After the start the lead can still click **Amend…** on a plan page. Any change to the frozen plan **pauses screening, coding and appraisal for everyone** (the sidebar turns red) until the lead resolves it in one of three ways:

- **Acknowledge as amendment**: give a reason; the change is logged with the date, who made it and how many decisions existed already, and becomes the new frozen plan. The log appears on the overview and in the paper data (`protocol.amendments`), ready for the deviations section of your paper.
- **Undo changes**: go back to the plan as it was frozen (not available for new or removed imports: remove the import instead).
- **Restart from scratch**: every reviewer's screening, coding and appraisal and all consensus decisions move to an archive inside the review (nothing is deleted, a backup is taken first), and screening starts again under the new plan. Calibration rounds are kept.

The review title, screening highlight terms, protocol notes and run notes are not frozen.

### 4.5 Title / abstract screening

For each record decide:

| Key | Decision | Meaning |
|---|---|---|
| `I` | Include | Clearly meets the criteria |
| `F` | Review with full text | Unsure: send it on and decide on the full text |
| `E` | Exclude | Clearly fails a criterion (tick which one) |

`1`–`9` tick criteria (for paired criteria: cycle meets → unclear → fails), `Enter` saves and moves on, `←`/`→` browse. Use *Review with full text* generously: that is what the JBI guidance recommends for ambiguous titles and abstracts.

**Calibration first (optional, recommended).** Once the lead has started a calibration round (see [Start the review](#start-the-review-freezing-the-plan)), every reviewer screens the same random pilot set. Compare under *Compare & consensus → Calibration*: the panel at the top shows the current round, its agreement so far and all earlier rounds; below are the pairwise agreement, κ per criterion (red below 0.4: criteria read differently) and the disagreeing records side by side. Discuss the disagreements, sharpen the criteria, and run another round on fresh records until you reach ≥ 75 % agreement. Calibration decisions are stored separately and never count in PRISMA. Because the plan is not frozen yet, changing the criteria now needs no amendment.

### 4.6 Full-text screening

Everything you included or sent to full text arrives here. The PDF opens next to the decision form.

- Select text in the PDF, or paste an excerpt with its page number, to store it as **evidence** linked to a criterion.
- Decide **Include**, **Exclude** (a primary reason is required, which feeds the PRISMA *reports excluded, with reasons* box) or **Not retrievable** (`N`).

### 4.7 Extraction & coding

Only final included sources appear here. Three tabs:

- **Code papers**: fill in the charting form and assign codes for each source, linking excerpts to codes.
- **Charting form**: define the extraction fields (short/long text, number, one or several of a list, yes/no/unclear). Start from the JBI scoping or systematic template.
- **Codebook**: codes with definition, *use when*, *do not use when*, example, and origin (a priori vs emergent; codes created while coding are marked emergent). Every change is logged, which you can report as codebook development. *Codes from review questions* gives you a starting set.

If several reports describe the same study, link them with **Same study as** so they are counted once.

### 4.8 Critical appraisal (if enabled)

Choose a tool (RoB 2, ROBINS-I, CASP qualitative, or a custom checklist), then judge each item with supporting text and give an overall judgement. Two reviewers appraise independently; disagreements and κ on the overall judgement appear in the appraisal's *Compare & consensus* tab.

### 4.9 Compare & consensus

Use this page throughout, not only at the end. Per stage (and for calibration) it shows:

- percent agreement and Cohen's κ for each reviewer pair: on the decision, on exclude vs. forward, per criterion, and per code,
- a confusion matrix,
- every record where the human reviewers disagree, with a form to record the **consensus decision**.

**How final decisions are made:** consensus if one has been recorded; otherwise the agreeing decision of the human reviewers who screened the record. A record that two humans decided differently is a **conflict** and stays undecided until you resolve it. LLM/agent reviewers are shown for comparison but never decide.

### 4.10 Results & analysis

Explore the included sources (or the full-text pool, or all records):

- **Overview**: sources per year, per database, codes per group, charting fields, appraisal.
- **Evidence map**: cross-tabulate any two dimensions (year, database, journal, keyword, code, code group, charting field, appraisal) as a heatmap; click a cell to see its sources.
- **Network**: co-occurrence of codes, keywords or authors, with clusters; export to VOSviewer.
- **Sources table**: everything in one list.

### 4.11 Export

Download what the paper needs: PRISMA counts, decision CSVs (with every reviewer's decision), evidence excerpts, coding and charting CSVs, the inter-rater agreement report, the search-strategy appendix, the included sources as RIS, and the complete review as JSON. See [section 7](#7-from-the-data-to-your-paper).

---

## 5. Working with several reviewers

**The lead reviewer.** Everyone sees every page, but only the lead reviewer changes the shared plan: protocol and criteria, searches and imports, duplicate flags, settings and the list of reviewers. The lead also starts the review (see [Start the review](#start-the-review-freezing-the-plan)). For everyone else these pages are read-only; attaching PDFs stays open to all. Make someone lead under *Reviewers → Edit → Lead reviewer*; a review can have more than one lead and always keeps at least one. Reviews created before this feature have no lead, so every human reviewer can edit until someone is made lead. This is a safeguard against accidental edits, not access control: who you review as is chosen in the browser.

**Set up workloads** on the *Reviewers* page. Per stage, each reviewer does either:

- **Full review**: every record, or
- **Random cross-check**: a fixed percentage. The sample is reproducible (derived from reviewer and record ids), so it stays the same as new records arrive, and you can report it.

A stage is only complete when every assigned human reviewer has finished their records and all conflicts are resolved.

**How two people work together:**

| Setup | How |
|---|---|
| One shared workspace (shared Google Drive/OneDrive/Dropbox folder, network drive) | Share the folder, both choose it as their workspace, and pick themselves on the start page (see [cloud folders](#cloud-folders-google-drive-onedrive-dropbox-nextcloud)) |
| Separate computers, no shared folder | Each exports their reviewer file (*Reviewers → Export*) and sends it; the other imports it (*Reviewers → Import*) |

Each reviewer only sees their own decisions while screening, so screening stays independent.

---

## 6. LLM and agent reviewers

You can add AI reviewers next to the humans, for example as a second screener to cross-check or to prioritise records. They are treated as reviewers of type *LLM/agent*: their decisions are compared and counted in agreement statistics, but **they never make a decision final**.

**Option A, recommended: Claude Code as an agent reviewer.** In the project folder, run `claude` and ask it to screen a stage. It uses the command-line helper `scripts/rh.mjs` to fetch the records it is assigned, decides each against your criteria, and writes:

- its decisions into its own reviewer file, and
- a reasoning log (`agent-logs/<reviewerId>/<runId>.jsonl`) with the criteria it checked, the evidence, its confidence and rationale for every record.

The reasoning appears under *Compare & consensus*. If you change the criteria later, decisions made under the old criteria are flagged.

**Option B: any other model.** On the *Reviewers* page, export the records and the prompt with your criteria, run them through the model of your choice, and import the resulting CSV with the columns `record_id` (or `doi`), `decision` (include / exclude / fulltext), `criteria`, `reason`, `confidence`, `rationale`, `note`.

**Report it.** Record the model, version and prompt variant on the reviewer (the *Model / setup* field), and describe the AI's role in your methods section. Check your target journal's and your methodology's current guidance on AI use in evidence synthesis; ReviewHub is built so that AI assists and human reviewers decide.

---

## 7. From the data to your paper

Everything the paper needs is derived from the files in your workspace, so every number can be traced back to a decision.

| In the paper | Where it comes from in ReviewHub |
|---|---|
| PRISMA flow diagram | *Overview* or *Export* (live diagram) · *PRISMA counts (JSON)* |
| Search strategy appendix | *Export → Search strategy (Markdown)* |
| Inter-rater agreement in the methods | *Export → Inter-rater agreement (Markdown)* |
| Table of excluded full texts with reasons | *Export → Full-text decisions (CSV)* |
| Characteristics of included sources | *Export → Coding / charting CSV* |
| Evidence map, networks | *Results & analysis* (CSV, SVG, VOSviewer files) |
| Reference list of included sources | *Export → Included sources (RIS)* into Zotero/EndNote |

**One file for all figures.** The *Paper data (JSON)* export, also written to disk by `npm run rh -- paper <review>` (into the review's `exports/` folder), collects the **final** values in one file: review metadata, searches, PRISMA counts, agreement, codebook, and every included source with its final codes, charting values and appraisal. Commit it with your manuscript and build every figure from it, so figures and text always match the review. [`docs/examples/figures.py`](examples/figures.py) shows how:

```bash
npm run rh -- paper "my review title"
pip install matplotlib
python docs/examples/figures.py <workspace>/reviews/<id>/exports/paper-data.json figures/
```

This writes the PRISMA numbers (`prisma.md`), an agreement table for the methods section (`agreement.md`), and figures of sources per year, codes, and an evidence map (codes × year) as PNG and SVG. Resolve all conflicts first: sources with unresolved coding conflicts are left out of the code figures (the script warns you). The format is described in [DATA.md](DATA.md#paper-data).

---

## 8. Backups, safety and troubleshooting

**Safety built in**

- Every save is atomic (no half-written files).
- `backups/` gets a snapshot of the review and all reviewer files at most every 10 minutes while you work; the last 50 are kept.
- Deleted reviews and removed reviewers go to `<workspace>/trash/`, never hard-deleted.
- Every decision keeps its earlier versions in `history`.

**Still back up the workspace** like any research data (institutional storage, Time Machine, etc.).

**Troubleshooting**

| Problem | Fix |
|---|---|
| *Port … is already in use* | ReviewHub (or another program) is already running on that port. Stop the other ReviewHub terminal, or find the program with `lsof -nP -iTCP:<port> -sTCP:LISTEN` (macOS/Linux) |
| Top bar says *Save failed: is the API running?* | The terminal running `npm run dev` was closed or crashed. Start it again; unsaved changes are retried |
| Top bar says *Changed elsewhere* | Someone (or Claude Code) changed the shared review file. Click *reload*. Your own decisions are in your own file and are not lost |
| An import shows fewer records than the database reported | The database capped the export. Export in batches and import each file into the same run |
| A PDF does not appear | Check it is attached on *Records & duplicates*; bulk matching needs the DOI or title in the file name |
| I can't find my reviews | Check which workspace is in use: setup guide, *settings*, or the line printed by `npm run dev`. After changing the folder without copying, your earlier reviews are still in the old folder: switch back, or switch again with *copy* |
| Reviews in a cloud folder are missing or outdated | The sync app has not finished, or the folder is not available offline. Wait for the sync, then *reload* |
