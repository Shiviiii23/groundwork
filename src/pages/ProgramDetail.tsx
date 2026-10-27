import { ArrowLeft, BookMarked, BookOpen, ExternalLink, Lightbulb } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import type { RuleResult } from "@shared/types";
import { Card, CardHeader, Empty, ErrorBox, Kpi, PageHeader, PageLoading, Pill, ProgressBar, RuleStatusPill, ScoreRing } from "../components/ui";
import { money, pageRanges, PROGRAM_TYPE_LABEL, shortDate } from "../lib/format";
import { useProjectStream } from "../lib/hooks";

function RuleTable({ results, points }: { results: RuleResult[]; points: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50/60 text-left">
            <th className="label w-[26%] px-5 py-2.5">Rule</th>
            <th className="label px-3 py-2.5">Status</th>
            {points && <th className="label px-3 py-2.5 text-right">Points</th>}
            <th className="label w-[18%] px-3 py-2.5">Your project</th>
            <th className="label w-[18%] px-3 py-2.5">Requirement</th>
            <th className="label px-3 py-2.5">How we got there</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.ruleId} className="border-b border-zinc-100 align-top last:border-0">
              <td className="px-5 py-3.5">
                <div className="font-medium text-zinc-900">{r.title}</div>
                <div className="mt-1 flex items-center gap-1 text-[11px] text-zinc-500">
                  <BookOpen size={11} /> {r.citation}
                </div>
              </td>
              <td className="px-3 py-3.5">
                <RuleStatusPill status={r.status} />
              </td>
              {points && (
                <td className="tnum whitespace-nowrap px-3 py-3.5 text-right">
                  <span className="font-semibold">{Math.round(r.pointsEarned * 10) / 10}</span>
                  <span className="text-zinc-400">/{r.maxPoints}</span>
                  <ProgressBar
                    className="mt-1.5 !h-1 w-16"
                    value={r.maxPoints ? (r.pointsEarned / r.maxPoints) * 100 : 0}
                    tone={r.pointsEarned >= r.maxPoints ? "good" : r.pointsEarned > 0 ? "warn" : "neutral"}
                  />
                </td>
              )}
              <td className="px-3 py-3.5 text-zinc-800">{r.actual}</td>
              <td className="px-3 py-3.5 text-zinc-600">{r.expected}</td>
              <td className="px-3 py-3.5">
                <div className="text-xs leading-relaxed text-zinc-600">{r.explanation}</div>
                {r.calculation && (
                  <div className="mt-1.5 rounded-md bg-zinc-50 px-2 py-1 font-mono text-[11px] leading-relaxed text-zinc-700 ring-1 ring-inset ring-zinc-100">
                    {r.calculation}
                  </div>
                )}
                {r.dataSources.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {r.dataSources.map((s) => (
                      <span key={s} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10.5px] text-zinc-600">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ProgramDetailPage() {
  const { id, programId } = useParams<{ id: string; programId: string }>();
  const { project, error } = useProjectStream(id);

  const program = project?.programs.find((p) => p.id === programId);
  const score = project?.scores.find((s) => s.programId === programId);
  const thresholds = useMemo(() => score?.results.filter((r) => r.kind === "threshold") ?? [], [score]);
  const points = useMemo(() => score?.results.filter((r) => r.kind === "points") ?? [], [score]);

  if (error && !project) return <ErrorBox error={error} />;
  if (!project) return <PageLoading />;
  if (!program) return <Empty title="Program not found" action={<Link to={`/projects/${id}`} className="btn-ghost">Back to project</Link>} />;

  return (
    <div className="space-y-6">
      <Link to={`/projects/${id}`} className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-800">
        <ArrowLeft size={13} /> {project.input.name}
      </Link>
      <PageHeader
        eyebrow={`${PROGRAM_TYPE_LABEL[program.type] ?? program.type} · ${program.jurisdiction === "federal" ? "Federal" : program.jurisdiction}`}
        title={program.name}
        subtitle={program.administrator}
        right={
          <a href={program.url} target="_blank" rel="noreferrer" className="btn-ghost">
            Program site <ExternalLink size={14} />
          </a>
        }
      />

      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="flex items-center gap-4 px-5 py-4">
          {score ? <ScoreRing value={score.fitScore} size={64} /> : null}
          <div>
            <div className="label">Fit score</div>
            <div className="mt-1">
              {score ? score.eligible ? <Pill tone="good">Eligible</Pill> : <Pill tone="bad">Not eligible</Pill> : <Pill>Not scored</Pill>}
            </div>
          </div>
        </Card>
        <Kpi
          label="Thresholds"
          value={score ? `${score.thresholdsPassed}/${score.thresholdsTotal}` : "—"}
          tone={score && score.thresholdsPassed < score.thresholdsTotal ? (score.eligible ? "warn" : "bad") : "default"}
        />
        <Kpi
          label="Competitive points"
          value={score && score.pointsPossible ? `${Math.round(score.pointsEarned * 10) / 10}/${score.pointsPossible}` : "n/a"}
          hint={score && score.pointsPossible ? `${Math.round(score.scorePct * 100)}% of available points` : "Non-competitive program"}
        />
        <Kpi label="Estimated award" value={money(score?.estimatedAward)} hint={program.typicalAward} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="About this program" />
          <div className="space-y-3 p-5 text-sm text-zinc-700">
            <p className="leading-relaxed">{program.description}</p>
            {program.extraction && (
              <p className="flex items-start gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                <BookMarked size={14} className="mt-0.5 shrink-0 text-indigo-500" />
                <span>
                  Rules extracted from pages <span className="tnum font-mono text-zinc-800">{pageRanges(program.extraction.relevantPages)}</span> of{" "}
                  {program.extraction.pageCount}
                  {program.extraction.cacheHit === "full" ? " · served from the " : " · cached in the "}
                  <Link to="/library" className="text-indigo-700 hover:underline">
                    rule library
                  </Link>{" "}
                  ({shortDate(program.extraction.extractedAt)})
                </span>
              </p>
            )}
            {score?.summary && <p className="rounded-lg bg-indigo-50/60 px-3 py-2 leading-relaxed text-indigo-900">{score.summary}</p>}
            <dl className="grid gap-x-6 gap-y-2 pt-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="label">Application cycle</dt>
                <dd className="mt-0.5 text-zinc-800">{program.applicationCycle}</dd>
              </div>
              <div>
                <dt className="label">Source document</dt>
                <dd className="mt-0.5">
                  <a href={program.sourceDocument.url} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">
                    {program.sourceDocument.title}
                    {program.sourceDocument.year ? ` (${program.sourceDocument.year})` : ""}
                  </a>
                </dd>
              </div>
              {score?.awardBasis && (
                <div className="sm:col-span-2">
                  <dt className="label">Award estimate basis</dt>
                  <dd className="mt-0.5 font-mono text-[11px] leading-relaxed text-zinc-700">{score.awardBasis}</dd>
                </div>
              )}
            </dl>
          </div>
        </Card>
        <Card>
          <CardHeader title="How to raise the score" icon={<Lightbulb size={16} />} />
          <div className="p-5">
            {score?.recommendations.length ? (
              <ol className="space-y-2.5">
                {score.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-zinc-700">
                    <span className="tnum mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-indigo-50 text-[11px] font-semibold text-indigo-700">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{r}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="text-sm text-zinc-500">No recommendations — this project already maximizes the rules we could evaluate.</div>
            )}
          </div>
        </Card>
      </div>

      {!score ? (
        <Empty title="Not scored yet" body="The scoring agent hasn't evaluated this program. It will appear here when the run completes." />
      ) : (
        <>
          <Card className="overflow-hidden">
            <CardHeader title="Threshold requirements" subtitle="Must all pass for eligibility" right={<span className="tnum text-xs text-zinc-500">{thresholds.length} rules</span>} />
            {thresholds.length ? <RuleTable results={thresholds} points={false} /> : <div className="p-5 text-sm text-zinc-500">No threshold rules.</div>}
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Competitive scoring" subtitle="Points awarded under the program's scoring criteria" right={<span className="tnum text-xs text-zinc-500">{points.length} rules</span>} />
            {points.length ? <RuleTable results={points} points /> : <div className="p-5 text-sm text-zinc-500">This program isn't scored competitively.</div>}
          </Card>
        </>
      )}

      {program.complianceRules.length > 0 && (
        <Card>
          <CardHeader title="Post-award compliance obligations" subtitle="Tracked on the compliance dashboard once awarded" />
          <ul className="divide-y divide-zinc-100">
            {program.complianceRules.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-4 px-5 py-3 text-sm">
                <div>
                  <div className="font-medium text-zinc-900">{c.title}</div>
                  <div className="text-xs text-zinc-500">{c.description}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Pill>{c.frequency}</Pill>
                  <span className="text-[11px] text-zinc-400">{c.citation}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
