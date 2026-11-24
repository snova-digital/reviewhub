import { useEffect, useState } from 'react';
import Papa from 'papaparse';
import { useReview } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { buildPaperData } from '../lib/paperData.js';
import { guide, reviewSettings } from '../lib/methods.js';
import { prismaCounts } from '../lib/prisma.js';
import { codingPool, criteriaFor, criterionCode, criterionLabel, criterionState, DECISION_LABEL, findCriterion, reasonLabel, decisionsOf, fieldText, finalAppraisal, finalCoding, finalDecision, finalField, ftPool, runLabel, uniqueRecords } from '../lib/model.js';
import { comparePair, compareCoding, kappaBand } from '../lib/agreement.js';
import { Button, Card, SectionTitle } from '../components/ui.jsx';

function download(name, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);

export default function ExportPage() {
  const { review } = useReview();
  const [version, setVersion] = useState(null);
  useEffect(() => { api.info().then((i) => setVersion(i.version || null)).catch(() => {}); }, []);
  const c = prismaCounts(review);
  const runName = Object.fromEntries(review.runs.map((r) => [r.id, r.database]));
  const pool = uniqueRecords(review);
  const base = slug(review.title);
  const reviewers = review.reviewers;
  const dec = (rv) => decisionsOf(review, rv.id);
  const col = (rv) => rv.name.replace(/[^A-Za-z0-9]+/g, '_');
  const codeName = Object.fromEntries(review.codebook.map((c) => [c.id, c.group ? `${c.group}: ${c.label}` : c.label]));

  // One row per record of the stage: final decision + each reviewer's decision side by side.
  const decisionRows = (stage) => (stage === 'ta' ? pool : ftPool(review)).map((r) => {
    const fin = finalDecision(review, stage, r.id);
    const row = {
      record_id: r.id, title: r.title, authors: r.authors.join('; '), year: r.year, journal: r.journal, doi: r.doi, source: runName[r.runId],
      final_decision: fin.decision ? DECISION_LABEL[fin.decision] : '', final_status: fin.status,
      final_exclusion_reason: fin.reason ? reasonLabel(review, fin.reason) : '',
      consensus_note: review.consensus?.[stage]?.[r.id]?.note || '',
    };
    for (const rv of reviewers) {
      const d = dec(rv).screening[stage][r.id];
      row[`${col(rv)}_decision`] = d ? DECISION_LABEL[d.decision] : '';
      // Ticked criteria by code; paired criteria as CODE=meets|unclear|fails.
      row[`${col(rv)}_criteria`] = d ? criteriaFor(review, stage).filter((c) => criterionState(d, c))
        .map((c) => (c.kind === 'paired' ? `${criterionCode(review, c.id)}=${criterionState(d, c)}` : criterionCode(review, c.id))).join(' ') : '';
      row[`${col(rv)}_reason`] = d?.reason ? criterionCode(review, d.reason) : '';
      row[`${col(rv)}_note`] = d?.note || '';
    }
    if (stage === 'ft') row.pdf = r.pdf?.originalName || '';
    return row;
  });

  const evidenceRows = () => reviewers.flatMap((rv) => Object.entries(dec(rv).evidence || {}).flatMap(([rid, list]) => {
    const r = review.records.find((x) => x.id === rid);
    return list.map((h) => ({
      reviewer: rv.name, record_id: rid, title: r?.title, stage: h.stage || 'ft', source: h.source || 'pdf', page: h.page ?? '',
      linked_to: h.stage === 'coding' ? (h.codeIds || []).map((id) => codeName[id] || '(deleted code)').join('; ') : h.criterionId ? criterionLabel(review, h.criterionId) : 'general',
      quote: h.text, comment: h.comment, created_at: h.createdAt,
    }));
  }));

  const codingRows = () => codingPool(review).map((r) => {
    const fin = finalCoding(review, r.id);
    const row = { record_id: r.id, title: r.title, year: r.year, doi: r.doi, final_status: fin.status, final_codes: fin.codes.map((id) => codeName[id] || '(deleted code)').join('; ') };
    for (const rv of reviewers) {
      const c = dec(rv).coding?.[r.id];
      row[`${col(rv)}_codes`] = c?.done ? c.codes.map((id) => codeName[id] || '(deleted code)').join('; ') : '';
      row[`${col(rv)}_note`] = c?.note || '';
    }
    for (const f of review.chartingForm || []) {
      const ff = finalField(review, r.id, f.id);
      row[`field: ${f.label}`] = ff.status === 'conflict' ? '(conflict)' : fieldText(ff.value);
      for (const rv of reviewers) { const v = dec(rv).coding?.[r.id]?.fields?.[f.id]; if (v != null && v !== '') row[`${col(rv)}_field: ${f.label}`] = fieldText(v); }
    }
    for (const code of review.codebook) row[`code: ${codeName[code.id]}`] = fin.codes.includes(code.id) ? 1 : 0;
    return row;
  });

  const tool = review.appraisalTool;
  const lbl = (scale, v) => scale?.find((s) => s.value === v)?.label || v || '';
  const appraisalRows = () => codingPool(review).map((r) => {
    const fin = finalAppraisal(review, r.id);
    const row = { record_id: r.id, title: r.title, year: r.year, final_status: fin.status, final_overall: lbl(tool?.overall, fin.overall) };
    for (const it of tool?.items || []) row[`final: ${it.label}`] = lbl(tool.scale, fin.answers?.[it.id]);
    for (const rv of reviewers) {
      const a = dec(rv).appraisal?.[r.id];
      if (!a?.done) continue;
      row[`${col(rv)}_overall`] = lbl(tool?.overall, a.overall);
      for (const it of tool?.items || []) { row[`${col(rv)}: ${it.label}`] = lbl(tool.scale, a.answers?.[it.id]); if (a.support?.[it.id]) row[`${col(rv)} support: ${it.label}`] = a.support[it.id]; }
    }
    return row;
  });

  // Agreement report for the methods section (pairwise, per stage, main screening and calibration).
  const agreementMd = () => {
    const lines = [`# Inter-rater agreement: ${review.title}`, '', `Generated ${new Date().toISOString().slice(0, 10)}. Cohen's κ, bands after Landis & Koch (1977).`, ''];
    for (const scope of ['screening', 'calibration']) for (const stage of ['ta', 'ft']) {
      lines.push(`## ${stage === 'ta' ? 'Title/abstract' : 'Full text'}: ${scope === 'screening' ? 'main screening' : 'calibration'}`, '', '| Pair | n | Agreement | κ | κ (exclude vs. not) |', '|---|---|---|---|---|');
      for (let i = 0; i < reviewers.length; i++) for (let j = i + 1; j < reviewers.length; j++) {
        const p = comparePair(dec(reviewers[i])[scope][stage], dec(reviewers[j])[scope][stage], {});
        if (!p.shared.length) continue;
        lines.push(`| ${reviewers[i].name} × ${reviewers[j].name} | ${p.shared.length} | ${Math.round(p.decision.agree * 100)}% | ${p.decision.kappa?.toFixed(2)} (${kappaBand(p.decision.kappa)}) | ${p.binary.kappa?.toFixed(2)} |`);
      }
      lines.push('');
    }
    lines.push('## Coding', '', '| Pair | n | Identical code sets |', '|---|---|---|');
    for (let i = 0; i < reviewers.length; i++) for (let j = i + 1; j < reviewers.length; j++) {
      const p = compareCoding(dec(reviewers[i]).coding || {}, dec(reviewers[j]).coding || {}, review.codebook);
      if (p.shared.length) lines.push(`| ${reviewers[i].name} × ${reviewers[j].name} | ${p.shared.length} | ${Math.round(p.exact * 100)}% |`);
    }
    return lines.join('\n');
  };

  const included = pool.filter((r) => finalDecision(review, 'ft', r.id).decision === 'include');
  const evCount = (rid) => reviewers.reduce((n, rv) => n + (dec(rv).evidence?.[rid] || []).length, 0);

  const ris = () => included.map((r) => [
    'TY  - JOUR', `TI  - ${r.title}`, ...r.authors.map((a) => `AU  - ${a}`), `PY  - ${r.year}`, `T2  - ${r.journal}`,
    r.doi && `DO  - ${r.doi}`, r.url && `UR  - ${r.url}`, r.abstract && `AB  - ${r.abstract}`, ...r.keywords.map((k) => `KW  - ${k}`), 'ER  - ',
  ].filter(Boolean).join('\n')).join('\n\n');

  const searchMd = () => [
    `# Search strategy: ${review.title}`, '',
    '| # | Database | Stream | Query | Date | Fields | Limits | Reported | Imported |', '|---|---|---|---|---|---|---|---|---|',
    ...review.runs.map((r, i) => `| ${i + 1} | ${r.database} | ${r.stream || ''} | ${r.variant || ''} | ${r.dateRun} | ${r.fields} | ${r.filters} ${r.dateRange} | ${r.reportedHits ?? ''} | ${c.perRun[i].imported} |`),
    '', ...review.runs.flatMap((r, i) => [`## ${i + 1}. ${runLabel(r)}`, '', '```', r.searchString, '```', r.notes ? `\n${r.notes}` : '', '']),
  ].join('\n');

  // How often each criterion was ticked (paired: met / unclear / failed): useful to report & refine criteria.
  const usage = (stage, cr) => {
    const states = reviewers.flatMap((rv) => Object.values(dec(rv).screening[stage]).map((d) => criterionState(d, cr)));
    if (cr.kind !== 'paired') return states.filter(Boolean).length;
    const n = (s) => states.filter((x) => x === s).length;
    return `${n('meets')} ✓ · ${n('unclear')} ? · ${n('fails')} ✗`;
  };
  const critStats = review.criteria.map((cr) => ({
    code: criterionCode(review, cr.id), text: cr.kind === 'paired' && cr.excludeText ? `${cr.text} / not: ${cr.excludeText}` : cr.text,
    ta: usage('ta', cr),
    ft: usage('ft', cr),
    reason: ftPool(review).filter((r) => { const f = finalDecision(review, 'ft', r.id); return f.decision === 'exclude' && f.reason && findCriterion(review, f.reason)?.id === cr.id; }).length,
  }));

  const exports = [
    ['Paper data (JSON)', 'Final values only, in one file for every figure and table of the paper: PRISMA counts, searches, agreement, codebook, charting fields, and included sources with codes, field values and appraisal. Also written to disk by the CLI (node scripts/rh.mjs paper).', () => download(`${base}-paper-data.json`, JSON.stringify(buildPaperData(review, { version }), null, 2), 'application/json')],
    ['Complete review (JSON)', 'Everything: protocol, runs, records, consensus, and every reviewer\'s decisions under "decisions".', () => download(`${base}.json`, JSON.stringify(review, null, 2), 'application/json')],
    ['Title/abstract decisions (CSV)', 'One row per record: final decision and each reviewer\'s decision, criteria and note.', () => download(`${base}-screening-ta.csv`, Papa.unparse(decisionRows('ta')), 'text/csv')],
    ['Full-text decisions (CSV)', 'Includes exclusion reasons for the PRISMA table of excluded studies.', () => download(`${base}-screening-ft.csv`, Papa.unparse(decisionRows('ft')), 'text/csv')],
    ['Evidence & excerpts (CSV)', 'Quoted passages (PDF highlights and pasted excerpts) per reviewer, with page and linked criterion or codes.', () => download(`${base}-evidence.csv`, Papa.unparse(evidenceRows()), 'text/csv')],
    ['Coding & charting (CSV)', 'Included sources: final codes and charting-form values, each coder\'s codes and values, and one 0/1 column per code.', () => download(`${base}-coding.csv`, Papa.unparse(codingRows()), 'text/csv')],
    ['Inter-rater agreement (Markdown)', 'Pairwise agreement and Cohen\'s κ per stage, for the methods section.', () => download(`${base}-agreement.md`, agreementMd(), 'text/markdown')],
    ...(reviewSettings(review).appraisal && tool ? [['Critical appraisal (CSV)', `Final and per-appraiser judgements (${tool.label}), with the support given for each item.`, () => download(`${base}-appraisal.csv`, Papa.unparse(appraisalRows()), 'text/csv')]] : []),
    ['Codebook (JSON)', 'Codes with definitions, rules, examples and origin, plus the change log: an appendix for the coding frame, and importable into another review.', () => download(`${base}-codebook.json`, JSON.stringify({ format: 'reviewhub-codebook', title: review.title, exportedAt: new Date().toISOString(), codes: review.codebook.map(({ id: _id, ...x }) => x), log: review.codebookLog || [] }, null, 2), 'application/json')],
    [`${guide(review, 'flow').replace(' flow', '')} counts (JSON)`, 'Numbers for the flow diagram.', () => download(`${base}-prisma.json`, JSON.stringify(c, null, 2), 'application/json')],
    ['Search strategy (Markdown)', `Appendix table + full search strings (${guide(review, 'searchItem')}).`, () => download(`${base}-search-strategy.md`, searchMd(), 'text/markdown')],
    ['Included sources (RIS)', 'Import into Zotero/EndNote for data charting.', () => download(`${base}-included.ris`, ris(), 'application/x-research-info-systems')],
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-8 py-8">
      <section>
        <SectionTitle title="Exports" hint="All data also lives on disk as JSON in your workspace, so you can analyse it directly in R / Python. Charts, evidence maps, networks and VOSviewer files are under Results & analysis." />
        <Card className="divide-y divide-stone-100">
          {exports.map(([t, d, fn]) => (
            <div key={t} className="flex items-center justify-between px-5 py-3">
              <div><div className="text-sm font-medium">{t}</div><div className="text-xs text-stone-500">{d}</div></div>
              <Button size="sm" onClick={fn}>Download</Button>
            </div>
          ))}
        </Card>
      </section>

      <section>
        <SectionTitle title="Criteria usage" hint="How often each criterion was ticked. Useful for reporting and to check whether a criterion is working as intended." />
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs text-stone-500"><tr><th className="px-4 py-2 font-medium">Criterion</th><th className="font-medium">T/A ticked (all reviewers)</th><th className="font-medium">FT ticked</th><th className="px-4 font-medium">Final FT exclusion reason</th></tr></thead>
            <tbody>
              {critStats.map((s) => (
                <tr key={s.code} className="border-t border-stone-100">
                  <td className="px-4 py-2"><b className="mr-1 text-stone-500">{s.code}</b>{s.text}</td>
                  <td className="tabular-nums">{s.ta}</td><td className="tabular-nums">{s.ft}</td><td className="px-4 tabular-nums">{s.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <section>
        <SectionTitle title={`Included sources of evidence (${included.length})`} />
        <Card className="divide-y divide-stone-100">
          {included.length === 0 && <div className="p-5 text-sm text-stone-500">None yet.</div>}
          {included.map((r) => (
            <div key={r.id} className="px-5 py-3 text-sm">
              <div className="font-medium">{r.title}</div>
              <div className="text-xs text-stone-500">{r.authors.slice(0, 3).join('; ')}{r.authors.length > 3 ? ' et al.' : ''} ({r.year}) {r.journal} · {evCount(r.id)} evidence passages · {finalCoding(review, r.id).codes.length} codes</div>
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
