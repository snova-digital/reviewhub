// PRISMA 2020 / PRISMA-ScR style flow diagram (HTML boxes, prints cleanly).
const Box = ({ children, tone = 'main', className = '' }) => (
  <div className={`rounded-md border px-3 py-2.5 text-[13px] leading-snug ${tone === 'side' ? 'border-stone-300 bg-stone-50' : 'border-stone-400 bg-white'} ${className}`}>{children}</div>
);
const N = ({ children }) => <b className="tabular-nums">(n = {children})</b>;
const Arrow = () => <div className="mx-auto h-5 w-px bg-stone-400" />;
const Side = () => <div className="h-px w-6 self-center bg-stone-400" />;
const Phase = ({ children, className = 'min-h-32' }) => (
  <div className={`flex w-7 items-center justify-center rounded bg-indigo-700 py-2 text-[10px] font-semibold uppercase tracking-wider text-white [writing-mode:vertical-rl] rotate-180 ${className}`}>{children}</div>
);

export default function PrismaDiagram({ c }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-3">
        <Phase>Identification</Phase>
        <div className="flex flex-1 items-stretch">
          <Box className="flex-1">
            {c.identifiedOther > 0 ? <>Records identified <N>{c.identified}</N>: databases/registers <N>{c.identifiedDatabases}</N>, other methods <N>{c.identifiedOther}</N></> : <>Records identified from databases/sources <N>{c.identified}</N></>}
            <ul className="mt-1 text-xs text-stone-600">
              {c.perDatabase.map((r) => <li key={r.id}>{r.database} (n = {r.imported}{r.reported != null && r.reported !== '' && Number(r.reported) !== r.imported ? `; reported ${r.reported}` : ''})</li>)}
            </ul>
          </Box>
          <Side />
          <Box tone="side" className="w-72">Records removed before screening:<br />Duplicate records removed <N>{c.duplicates}</N></Box>
        </div>
      </div>
      <div className="flex gap-3">
        <Phase>Screening</Phase>
        <div className="flex-1 space-y-0">
          <div className="flex"><Box className="flex-1">Records screened (title/abstract) <N>{c.taScreened}</N>{c.taPending > 0 && <div className="text-xs text-amber-700">{c.taPending} still pending{c.taConflicts ? ` (${c.taConflicts} reviewer conflicts)` : ''}</div>}</Box><Side /><Box tone="side" className="w-72">Records excluded <N>{c.taExcluded}</N></Box></div>
          <div className="w-[calc(100%-19.5rem)]"><Arrow /></div>
          <div className="flex"><Box className="flex-1">Reports sought for retrieval <N>{c.sought}</N><div className="text-xs text-stone-500">{c.taInclude} included + {c.taUnclear} sent to full-text review at T/A</div></Box><Side /><Box tone="side" className="w-72">Reports not retrieved <N>{c.notRetrieved}</N></Box></div>
          <div className="w-[calc(100%-19.5rem)]"><Arrow /></div>
          <div className="flex">
            <Box className="flex-1">Reports assessed for eligibility <N>{c.assessed}</N>{c.ftPending > 0 && <div className="text-xs text-amber-700">{c.ftPending} still pending{c.ftConflicts ? ` (${c.ftConflicts} reviewer conflicts)` : ''}</div>}</Box>
            <Side />
            <Box tone="side" className="w-72">
              Reports excluded <N>{c.ftExcluded}</N>
              <ul className="mt-1 text-xs text-stone-600">{c.reasons.map(([k, v]) => <li key={k}>{k.length > 60 ? k.slice(0, 60) + '…' : k} (n = {v})</li>)}</ul>
            </Box>
          </div>
        </div>
      </div>
      <div className="flex gap-3">
        <Phase className="min-h-20">Included</Phase>
        <div className="flex-1"><div className="w-[calc(100%-19.5rem)]"><Box className="border-indigo-600 bg-indigo-50">{c.studies != null && c.studies !== c.ftIncluded ? <>Studies included in review <N>{c.studies}</N><br />Reports of included studies <N>{c.ftIncluded}</N></> : <>Sources of evidence included in review <N>{c.ftIncluded}</N></>}</Box></div></div>
      </div>
    </div>
  );
}
