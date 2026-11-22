// Method profiles: everything that differs between review types (scoping, systematic, rapid, other).
// The UI reads guidance text, the eligibility framework, and templates from here instead of hardcoding JBI wording,
// so a review's type decides which methodology the app speaks.

// ---- eligibility frameworks ---------------------------------------------------
// Element keys of PCC (population / concept / context) are the ones stored in protocol.pcc by older reviews.
export const FRAMEWORKS = {
  pcc: { label: 'PCC: Population, Concept, Context', hint: 'The JBI mnemonic for scoping review eligibility.',
    elements: [['population', 'Population'], ['concept', 'Concept'], ['context', 'Context']] },
  pico: { label: 'PICO: Population, Intervention, Comparator, Outcome', hint: 'Standard for intervention questions (Cochrane).',
    elements: [['population', 'Population'], ['intervention', 'Intervention'], ['comparator', 'Comparator'], ['outcome', 'Outcome']] },
  picos: { label: 'PICOS: PICO + Study design', hint: 'PICO with the eligible study designs made explicit.',
    elements: [['population', 'Population'], ['intervention', 'Intervention'], ['comparator', 'Comparator'], ['outcome', 'Outcome'], ['studyDesign', 'Study design']] },
  peo: { label: 'PEO: Population, Exposure, Outcome', hint: 'For aetiology / exposure questions and qualitative designs.',
    elements: [['population', 'Population'], ['exposure', 'Exposure'], ['outcome', 'Outcome']] },
  spider: { label: 'SPIDER: Sample, Phenomenon of Interest, Design, Evaluation, Research type', hint: 'For qualitative and mixed-methods evidence.',
    elements: [['sample', 'Sample'], ['phenomenon', 'Phenomenon of interest'], ['design', 'Design'], ['evaluation', 'Evaluation'], ['researchType', 'Research type']] },
  spice: { label: 'SPICE: Setting, Perspective, Intervention/Interest, Comparison, Evaluation', hint: 'Common in social sciences, information systems and policy research.',
    elements: [['setting', 'Setting'], ['perspective', 'Perspective'], ['interest', 'Intervention / interest'], ['comparison', 'Comparison'], ['evaluation', 'Evaluation']] },
  custom: { label: 'Custom elements', hint: 'Define your own elements in the review settings.', elements: [] },
};

// Practical eligibility dimensions available in every framework.
const EXTRA_ELEMENTS = [['source', 'Types of evidence source'], ['language', 'Language'], ['date', 'Date range'], ['other', 'Other']];

export function frameworkElements(review) {
  const s = reviewSettings(review);
  if (s.framework === 'custom') return (s.customElements || []).filter((e) => e.label?.trim()).map((e) => [e.key, e.label]);
  return (FRAMEWORKS[s.framework] || FRAMEWORKS.pcc).elements;
}

// Criterion element options: the framework's elements plus the practical dimensions.
export const criterionElements = (review) =>
  [...frameworkElements(review), ...EXTRA_ELEMENTS].map(([value, label]) => ({ value, label }));

// Element values live in protocol.elements; PCC values of older reviews in protocol.pcc (still kept in sync).
export const frameworkValues = (review) => ({ ...(review.protocol?.pcc || {}), ...(review.protocol?.elements || {}) });

// ---- method profiles -------------------------------------------------------------
export const PROFILES = {
  scoping: {
    label: 'Scoping review (JBI / PRISMA-ScR)', short: 'Scoping review', guideline: 'PRISMA-ScR', methodology: 'JBI',
    processLabel: 'JBI process', framework: 'pcc', appraisal: false, charting: 'scoping',
    text: {
      protocol: 'JBI recommends an a-priori protocol (registered e.g. on OSF or in JBI Evidence Synthesis) defining objective, questions and the eligibility framework before searching.',
      reviewersField: 'Managed under Reviewers. JBI: ≥2 independent reviewers for screening.',
      reviewers: 'JBI recommends at least two independent reviewers.',
      deviation: 'Changing criteria after piloting must be reported as a protocol deviation (PRISMA-ScR item 5).',
      pilotTarget: 'JBI pilot target ≥ 75%',
      pilotTip: 'Tip (JBI): pilot the criteria with your co-reviewer before screening everything, aiming for ≥75% agreement. Use the Calibration toggle on the screening page, then compare under Compare & consensus.',
      basket: 'JBI: when a record is ambiguous or difficult to classify, put it in the review with full text basket and say why in the note.',
      flow: 'PRISMA-ScR flow',
      searchItem: 'PRISMA-ScR item 8 / PRISMA-S',
      charting: 'JBI: draft the data charting form a priori from the review questions, pilot it on 2–3 sources with all reviewers, and refine it iteratively. Record changes as they happen.',
      appraisal: 'Critical appraisal is optional in scoping reviews (JBI). If you do appraise, report the method and results (PRISMA-ScR items 12 and 16).',
      codebook: 'Usual practice is hybrid coding: a deductive (a-priori) set derived from the review questions or an existing framework, extended inductively by emergent codes during charting. Define each code so that all coders apply it the same way, and keep a change log.',
    },
  },
  systematic: {
    label: 'Systematic review (PRISMA 2020)', short: 'Systematic review', guideline: 'PRISMA 2020', methodology: 'Cochrane Handbook',
    processLabel: 'Review process', framework: 'pico', appraisal: true, charting: 'systematic',
    text: {
      protocol: 'Register the protocol before screening, e.g. on PROSPERO or OSF (PRISMA 2020 item 24), defining objectives, eligibility criteria and the planned methods.',
      reviewersField: 'Managed under Reviewers. Cochrane: two reviewers screen and extract independently.',
      reviewers: 'Cochrane recommends that at least two reviewers independently screen each record and extract data.',
      deviation: 'Amendments to the registered protocol must be reported (PRISMA 2020 item 24c).',
      pilotTarget: 'Pilot target: κ ≥ 0.6',
      pilotTip: 'Tip: pilot the eligibility criteria on a sample with all screeners before screening everything, and sharpen wording where you disagree. Use the Calibration toggle on the screening page.',
      basket: 'When eligibility cannot be judged from title and abstract, send the record to full text and say why in the note (err on the side of inclusion).',
      flow: 'PRISMA 2020 flow',
      searchItem: 'PRISMA 2020 item 7 / PRISMA-S',
      charting: 'Use a data extraction form that was piloted on a few studies (PRISMA 2020 items 9–10). Extract independently in duplicate where possible.',
      appraisal: 'Assess the risk of bias of every included study with a validated tool (e.g. RoB 2, ROBINS-I), independently by two reviewers (PRISMA 2020 item 11).',
      codebook: 'Codes complement the extraction form for qualitative synthesis. Define each code (when to use it, when not) and keep a change log.',
    },
  },
  rapid: {
    label: 'Rapid review (Cochrane RR methods)', short: 'Rapid review', guideline: 'PRISMA 2020', methodology: 'Cochrane Rapid Reviews Methods Group',
    processLabel: 'Review process', framework: 'pico', appraisal: true, charting: 'systematic',
    text: {
      protocol: 'Even rapid reviews should have a short a-priori protocol (e.g. on OSF) with questions and eligibility criteria.',
      reviewersField: 'Managed under Reviewers. Rapid reviews may single-screen after a dual-screened calibration.',
      reviewers: 'Cochrane rapid review guidance: dual-screen a calibration sample (e.g. 30–50 abstracts); afterwards one reviewer can screen while a second checks the exclusions (use a cross-check sample).',
      deviation: 'Report changes to the protocol and any shortcuts taken.',
      pilotTarget: 'Calibrate until agreement is good',
      pilotTip: 'Tip: calibrate on 30–50 abstracts with two reviewers first. Use the Calibration toggle on the screening page.',
      basket: 'When eligibility cannot be judged from title and abstract, send the record to full text.',
      flow: 'PRISMA 2020 flow',
      searchItem: 'PRISMA 2020 item 7 / PRISMA-S',
      charting: 'Use a short, piloted extraction form. One reviewer may extract, with a second checking for correctness and completeness.',
      appraisal: 'Assess risk of bias with a validated tool; one reviewer may appraise with a second verifying the judgements.',
      codebook: 'Keep the codebook small and defined; add emergent codes sparingly and log changes.',
    },
  },
  other: {
    label: 'Other literature review (custom)', short: 'Literature review', guideline: 'PRISMA 2020', methodology: 'Custom',
    processLabel: 'Review process', framework: 'custom', appraisal: false, charting: 'scoping',
    text: {
      protocol: 'Document objective, questions and eligibility criteria before searching, ideally as a registered protocol.',
      reviewersField: 'Managed under Reviewers. At least two independent reviewers improve reliability.',
      reviewers: 'At least two independent reviewers improve reliability.',
      deviation: 'Changes to the criteria after piloting should be reported as protocol deviations.',
      pilotTarget: 'Pilot target ≥ 75%',
      pilotTip: 'Tip: pilot the criteria with your co-reviewer before screening everything. Use the Calibration toggle on the screening page.',
      basket: 'When a record is ambiguous, put it in the review with full text basket and say why in the note.',
      flow: 'PRISMA flow',
      searchItem: 'PRISMA-S',
      charting: 'Draft the extraction form from the review questions, pilot it on a few sources and refine it.',
      appraisal: 'Choose an appraisal tool that fits the designs of the included sources, or define your own items.',
      codebook: 'Combine codes derived from the review questions with emergent codes; define each and log changes.',
    },
  },
};

export const REVIEW_TYPES = Object.entries(PROFILES).map(([value, p]) => ({ value, label: p.label }));
export const profileOf = (review) => PROFILES[review?.type] || PROFILES.scoping;
export const guide = (review, key) => profileOf(review).text[key] || '';

// ---- per-review settings with defaults (no migration needed: missing keys fall back here) -----------
export const DEDUP_MODES = [
  { value: 'strict', label: 'Strict: same DOI, or identical normalised title (± 1 year)' },
  { value: 'fuzzy', label: 'Fuzzy: also near-identical titles (≥ 90% similar) with matching year and first author' },
];

export function reviewSettings(review) {
  const s = review?.settings || {};
  const p = profileOf(review);
  return {
    ...s,
    calibrationSize: s.calibrationSize || 20,
    framework: s.framework || p.framework,
    customElements: s.customElements || [],
    dedup: s.dedup || 'strict',
    streams: s.streams ?? !!review?.runs?.some((r) => r.stream),
    appraisal: s.appraisal ?? p.appraisal,
  };
}

// ---- charting (data extraction) form templates ---------------------------------------
export const FIELD_TYPES = [
  { value: 'text', label: 'Short text' },
  { value: 'longtext', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'One of a list' },
  { value: 'multiselect', label: 'Several of a list' },
  { value: 'yesno', label: 'Yes / no / unclear' },
];

const f = (label, type = 'text', extra = {}) => ({ label, type, options: [], help: '', ...extra });
export const CHARTING_TEMPLATES = {
  scoping: {
    label: 'JBI scoping review charting form',
    fields: [
      f('Country of origin'),
      f('Aims / purpose', 'longtext'),
      f('Population and sample size', 'longtext'),
      f('Methodology / methods', 'select', { options: ['Empirical: quantitative', 'Empirical: qualitative', 'Empirical: mixed methods', 'Design science / artefact', 'Conceptual / theoretical', 'Review', 'Legal / doctrinal analysis', 'Other'] }),
      f('Concept (as addressed by the source)', 'longtext'),
      f('Context', 'longtext'),
      f('Type of evidence source', 'select', { options: ['Journal article', 'Conference paper', 'Book / chapter', 'Report / grey literature', 'Preprint', 'Other'] }),
      f('Key findings relating to the review questions', 'longtext'),
    ],
  },
  systematic: {
    label: 'Systematic review extraction form',
    fields: [
      f('Study design', 'select', { options: ['RCT', 'Non-randomised controlled', 'Cohort', 'Case-control', 'Cross-sectional', 'Qualitative', 'Mixed methods', 'Other'] }),
      f('Country'),
      f('Setting'),
      f('Sample size', 'number'),
      f('Population characteristics', 'longtext'),
      f('Intervention / exposure', 'longtext'),
      f('Comparator', 'longtext'),
      f('Outcomes measured', 'longtext'),
      f('Main results', 'longtext'),
      f('Funding source'),
      f('Conflicts of interest declared', 'yesno'),
    ],
  },
};

// ---- critical appraisal / risk-of-bias tools -----------------------------------------
const ROB_SCALE = [
  { value: 'low', label: 'Low', tone: 'include' },
  { value: 'some', label: 'Some concerns', tone: 'unclear' },
  { value: 'high', label: 'High', tone: 'exclude' },
];
const ROBINS_SCALE = [
  { value: 'low', label: 'Low', tone: 'include' },
  { value: 'moderate', label: 'Moderate', tone: 'unclear' },
  { value: 'serious', label: 'Serious', tone: 'exclude' },
  { value: 'critical', label: 'Critical', tone: 'exclude' },
  { value: 'ni', label: 'No information', tone: 'pending' },
];
const YNU_SCALE = [
  { value: 'yes', label: 'Yes', tone: 'include' },
  { value: 'cant_tell', label: "Can't tell", tone: 'unclear' },
  { value: 'no', label: 'No', tone: 'exclude' },
];
const QUALITY_SCALE = [
  { value: 'high', label: 'High quality', tone: 'include' },
  { value: 'moderate', label: 'Moderate', tone: 'unclear' },
  { value: 'low', label: 'Low quality', tone: 'exclude' },
];

export const APPRAISAL_TOOLS = {
  rob2: {
    label: 'RoB 2 (randomised trials)', scale: ROB_SCALE, overall: ROB_SCALE,
    items: ['Bias arising from the randomisation process', 'Bias due to deviations from intended interventions', 'Bias due to missing outcome data',
      'Bias in measurement of the outcome', 'Bias in selection of the reported result'],
  },
  robinsi: {
    label: 'ROBINS-I (non-randomised studies of interventions)', scale: ROBINS_SCALE, overall: ROBINS_SCALE,
    items: ['Bias due to confounding', 'Bias in selection of participants into the study', 'Bias in classification of interventions',
      'Bias due to deviations from intended interventions', 'Bias due to missing data', 'Bias in measurement of outcomes', 'Bias in selection of the reported result'],
  },
  caspqual: {
    label: 'CASP qualitative checklist', scale: YNU_SCALE, overall: QUALITY_SCALE,
    items: ['Was there a clear statement of the aims of the research?', 'Is a qualitative methodology appropriate?', 'Was the research design appropriate to address the aims of the research?',
      'Was the recruitment strategy appropriate to the aims of the research?', 'Was the data collected in a way that addressed the research issue?',
      'Has the relationship between researcher and participants been adequately considered?', 'Have ethical issues been taken into consideration?',
      'Was the data analysis sufficiently rigorous?', 'Is there a clear statement of findings?', 'How valuable is the research?'],
  },
  custom: { label: 'Custom checklist', scale: YNU_SCALE, overall: QUALITY_SCALE, items: [] },
};
