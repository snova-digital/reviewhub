# ReviewHub data format

All ReviewHub data is plain JSON (plus your original import files and PDFs) in one folder, the **workspace**. You can read it with any language, put it under version control, or archive it with your paper (e.g. on OSF or Zenodo).

See the [tutorial](TUTORIAL.md#2-where-your-data-lives) for how the workspace location is chosen.

## Folder layout

```
<workspace>/
  reviews/
    <reviewId>/                      e.g. rev_6e63357a30
      review.json                    shared review state
      decisions/<reviewerId>.json    one file per reviewer
      agent-logs/<reviewerId>/<runId>.jsonl   agent reasoning logs (append-only)
      imports/                       raw database export files, verbatim
      pdfs/<recordId>.pdf            full texts
      backups/review-<timestamp>.json  snapshots: review.json + all reviewer files
      exports/paper-data.json        final values for the paper (see below)
  trash/                             deleted reviews and removed reviewer files
```

Ids are stable and prefixed: `rev_` review, `rv_` reviewer, `run_` search run, `rec_` record, `c_` criterion.

## `review.json`: the shared state

| Key | Content |
|---|---|
| `schemaVersion`, `rev`, `createdAt`, `updatedAt` | Format version; `rev` increases with every save and protects against overwriting someone else's change |
| `type`, `title` | Review type (`scoping`, `systematic`, `rapid`, `other`) and title |
| `settings` | Framework, calibration set (`calibrationSize`, `calibrationStream`), deduplication mode, appraisal and streams switches |
| `calibration` | Optional calibration rounds started by the lead: `{ rounds: [ { n, startedAt, startedBy, reason, method: "random", seed, size, stream, poolSize, drawnAt, ta: [recordId], closedAt, closedBy, results, criteria } ] }`. The last round is the current one. `stream` is `""` (all records), a stream name, or `"*"` (stratified: the same number from every stream). Records are ordered by a hash of seed and record id; each round leaves out the records of earlier rounds. A closed round keeps its `results` (pairwise agreement, κ, κ per criterion) and the `criteria` as they were. Full-text calibration uses the same seeded order over the full-text pool. Older reviews without rounds use the first N records |
| `protocol` | Objective, questions, framework `elements` (PCC values are mirrored in `pcc`), registration, evidence sources, highlight terms, notes |
| `criteria[]` | `{ id, code, kind: inclusion\|exclusion\|paired, element, text, stages: [ta, ft] }`. Paired criteria also have `excludeText` (the exclusion side) and `mergedFrom` (ids of exclusion criteria folded into them; old decisions that ticked those count as *fails*) `streams: [name]` limits a criterion to records found by those search streams (empty = all records; only while search streams are on) |
| `runs[]` | Search runs: `database, platform, searchString, fields, dateRun, dateRange, filters, reportedHits, notes, imports[]` |
| `records[]` | Imported records: `id, runId, importId, title, abstract, keywords, authors, year, journal, doi, url, type, pdf, duplicateOf, dupBy, studyOf` |
| `reviewers[]` | `{ id, name, type: human\|llm, lead, model, assignment: { ta, ft, coding, appraisal: { mode: full\|sample\|none, percent } } }`. `lead: true` marks a lead reviewer, who alone changes the plan |
| `lock` | Official start: `{ startedAt, startedBy, baseline, log[] }`. `baseline` is the frozen plan (type, method settings, protocol, criteria, runs); any difference to it pauses screening. `log` lists `start`, `amendment` (`reason`, `changes`, `decisionsBefore`) and `restart` (`reason`, `changes`, `decisionsArchived`) entries |
| `archive[]` | Consensus decisions set aside by a restart: `{ archivedAt, reason, consensus }` |
| `codebook[]`, `codebookLog[]` | Codes (label, group, definition, use/not-when, example, origin) and their change history |
| `chartingForm[]` | Extraction fields: `{ id, label, type, options }` |
| `appraisalTool` | The chosen appraisal tool and its items |
| `consensus` | Consensus decisions per stage: `ta`, `ft`, `coding`, `appraisal`, keyed by record id |

A record with `duplicateOf` set is a flagged duplicate and is not screened.

## `decisions/<reviewerId>.json`: one reviewer's work

| Key | Content |
|---|---|
| `screening.ta`, `screening.ft` | Decisions keyed by record id |
| `calibration.ta`, `calibration.ft`, `calibrationArchive` | Pilot-round decisions (never counted in PRISMA) of the current round, and earlier rounds (`{ stage, round, archivedAt, decisions }`) |
| `evidence` | Excerpts from full texts: text, page, linked criterion or codes |
| `coding` | Per record: `codes[]`, `fields{}` (charting values), `done` |
| `appraisal` | Per record: item judgements with support, overall judgement, `done` |
| `archive[]` | Work set aside when the lead restarted the review: `{ archivedAt, reason, screening, evidence, coding, appraisal }` |

A screening decision looks like this:

```jsonc
{
  "decision": "exclude",          // include | unclear (= "review with full text") | exclude | not_retrieved
  "checked": ["c_..."],           // criteria ticked (incl. paired criteria that are met)
  "marks": { "c_...": "fails" },  // paired criteria: meets | unclear | fails
  "reason": "c_...",              // primary exclusion criterion
  "note": "",
  "decidedAt": "2026-11-13T11:07:45.264Z",
  "history": [],                  // earlier versions of this decision
  "agent": {                      // only for agent reviewers
    "runId": "...", "criteriaHash": "...", "confidence": 0.8, "rationale": "...", "criteria": [ ... ]
  }
}
```

## Agent reasoning logs

`agent-logs/<reviewerId>/<runId>.jsonl` is written append-only by agent reviewers. Line 1 describes the run; every following line is one decision:

```json
{"type":"run","runId":"...","model":"...","promptVersion":"...","criteriaHash":"...","stage":"ta","scope":"main","startedAt":"..."}
{"type":"decision","recordId":"rec_...","stage":"ta","inputs":{"fields":["title","abstract"]},"criteria":[{"code":"IC1","met":"yes","evidence":"...","location":"abstract"}],"decision":"include","reason":null,"confidence":0.9,"rationale":"..."}
```

## How final values are derived

ReviewHub never stores "the" final decision separately. It derives it whenever needed:

1. If a **consensus** entry exists for the record and stage, that is final.
2. Otherwise the decisions of the **human** reviewers who decided the record: if they agree, that is final. If they disagree, the record is a **conflict** and has no final decision.
3. At title/abstract, *include* and *review with full text* do not conflict (both send the record on).
4. LLM/agent reviewers never count.

The same rule applies to codes, charting values and appraisal judgements.

<a id="paper-data"></a>
## Paper data: `exports/paper-data.json`

Because final values are derived, build the paper from one generated snapshot rather than from the raw files. `npm run rh -- paper <review>` writes it to the review's `exports/paper-data.json`; *Export → Paper data (JSON)* downloads the same content.

It contains **final values only** (consensus, or agreement of the human reviewers):

| Key | Content |
|---|---|
| `format`, `version`, `generatedAt`, `reviewhubVersion` | `"reviewhub-paper-data"`, `1`, and when / with which version it was made |
| `review` | `id, title, type, guideline, methodology, framework`, `protocol { objective, questions, registration, elements { key: { label, text } }, evidenceSources, deviations, startedAt, calibrationRounds [ { round, startedAt, closedAt, reason, sample { method, size, poolSize, stream, seed }, results { records, reviewers, pairs [ { a, b, n, agree, kappa, binaryKappa, perCriterion } ] } } ], amendments [ { kind, at, by, reason, changes, decisionsBefore } ] }`, `criteria [ { code, kind, element, stages, text } ]` |
| `reviewers` | `[ { id, name, type, model, assignment } ]` |
| `searches` | `[ { database, platform, sourceType, stream, variant, dateRun, dateRange, searchString, fields, filters, reportedHits, imported } ]` |
| `prisma` | Flow numbers: `identified, identifiedDatabases, identifiedOther, perDatabase[], duplicates, unique, taScreened, taExcluded, sought, notRetrieved, assessed, ftExcluded, reasons [[label, n]], ftIncluded, studies`, plus pending / conflict counts |
| `agreement` | `ta`, `ft`, `calibration { ta, ft }`: `[ { a, b, aType, bType, n, percentAgreement, kappa, kappaExcludeVsForward } ]` · `coding`: `[ { a, b, n, identicalCodeSets, meanKappaPerCode } ]` · `appraisal`: `[ { a, b, n, percentAgreement, kappa } ]` |
| `codebook` | `[ { id, label, group, definition, origin } ]` |
| `chartingFields` | `[ { key, label, type, options } ]` (`key` is a slug of the label) |
| `appraisalTool` | The tool and its items, if appraisal is used |
| `included` | `[ { id, title, authors, year, journal, doi, keywords, database, studyOf, codes: [codeId], codingStatus, fields { key: value }, appraisal { tool, overall, items, status } \| null } ]` |
| `excludedFullText` | `[ { id, title, authors, year, doi, reasonCode, reason } ]`: the table of excluded full texts with reasons |

`codingStatus` is `consensus`, `agreed`, `single`, `conflict` or `pending`. For `conflict` and `pending`, `codes` is empty: codes nobody agreed on never reach your figures (the app's Results page leaves them out the same way). Resolve every conflict before you generate the final file. [`examples/figures.py`](examples/figures.py) warns you about any it finds.

**Recommended practice:** generate it when the review is finished, commit it next to your manuscript (or deposit it with your data), and produce every figure and table from it. Then the numbers in the text, the PRISMA diagram and the figures all come from the same snapshot.
