import clsx from "clsx";
import { ArrowUpRight, Award, CheckCircle2, ExternalLink, Sparkles, Upload, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FundingProgram, ProgramScore, PursuitStatus } from "@shared/types";
import { money, PROGRAM_TYPE_LABEL } from "../lib/format";
import { Card, CardHeader, Pill, ScoreRing } from "./ui";

export type ScoredProgram = { program: FundingProgram; score?: ProgramScore };

export function rankPrograms(programs: FundingProgram[], scores: ProgramScore[]): ScoredProgram[] {
  const byId = new Map(scores.map((s) => [s.programId, s]));
  return programs
    .map((p) => ({ program: p, score: byId.get(p.id) }))
    .sort((a, b) => {
      if (!a.score && !b.score) return 0;
      if (!a.score) return 1;
      if (!b.score) return -1;
      if (a.score.eligible !== b.score.eligible) return a.score.eligible ? -1 : 1;
      return b.score.fitScore - a.score.fitScore;
    });
}

const PURSUIT: { value: PursuitStatus; label: string }[] = [
  { value: "considering", label: "Considering" },
  { value: "applying", label: "Applying" },
  { value: "awarded", label: "Awarded" },
  { value: "declined", label: "Declined" },
];

function DiscoveredBadge({ by }: { by: FundingProgram["discoveredBy"] }) {
  if (by === "web_search")
    return (
      <Pill tone="accent" icon={<Sparkles size={11} />}>
        Found by web search
      </Pill>
    );
  if (by === "uploaded_document")
    return (
      <Pill tone="info" icon={<Upload size={11} />}>
        From your document
      </Pill>
    );
  return null;
}

export function ProgramCard({
  projectId,
  item,
  rank,
  onPursuit,
}: {
  projectId: string;
  item: ScoredProgram;
  rank: number;
  onPursuit: (programId: string, p: PursuitStatus) => void;
}) {
  const { program: p, score: s } = item;
  return (
    <Card className="group flex flex-col p-5 transition hover:border-zinc-300 hover:shadow-sm">
      <div className="flex items-start gap-4">
        {s ? <ScoreRing value={s.fitScore} /> : <div className="h-[52px] w-[52px] shrink-0 animate-pulse rounded-full bg-zinc-100" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="tnum font-semibold text-zinc-400">#{rank}</span>
            <span>{PROGRAM_TYPE_LABEL[p.type] ?? p.type}</span>
            <span>·</span>
            <span className="truncate">{p.jurisdiction === "federal" ? "Federal" : p.jurisdiction}</span>
          </div>
          <Link to={`/projects/${projectId}/programs/${p.id}`} className="mt-0.5 block text-[15px] font-semibold leading-snug text-zinc-900 hover:text-indigo-700">
            {p.name}
          </Link>
          <div className="mt-0.5 truncate text-xs text-zinc-500">{p.administrator}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {s ? (
          s.eligible ? (
            <Pill tone="good" icon={<CheckCircle2 size={11} />}>
              Eligible
            </Pill>
          ) : (
            <Pill tone="bad" icon={<XCircle size={11} />}>
              Not eligible
            </Pill>
          )
        ) : (
          <Pill>Scoring…</Pill>
        )}
        <DiscoveredBadge by={p.discoveredBy} />
        {p.pursuit === "awarded" && (
          <Pill tone="good" icon={<Award size={11} />}>
            Awarded
          </Pill>
        )}
      </div>

      {s && (
        <div className="tnum mt-4 grid grid-cols-3 gap-3 border-t border-zinc-100 pt-3 text-xs">
          <div>
            <div className="label">Thresholds</div>
            <div className={clsx("mt-0.5 text-sm font-semibold", s.thresholdsPassed < s.thresholdsTotal ? (s.eligible ? "text-amber-700" : "text-red-700") : "text-zinc-900")}>
              {s.thresholdsPassed}/{s.thresholdsTotal}
            </div>
          </div>
          <div>
            <div className="label">Points</div>
            <div className="mt-0.5 text-sm font-semibold">
              {s.pointsPossible > 0 ? (
                <>
                  {Math.round(s.pointsEarned * 10) / 10}
                  <span className="font-normal text-zinc-400">/{s.pointsPossible}</span>
                </>
              ) : (
                <span className="text-zinc-400">n/a</span>
              )}
            </div>
          </div>
          <div>
            <div className="label">Est. award</div>
            <div className="mt-0.5 text-sm font-semibold">{money(s.estimatedAward)}</div>
          </div>
        </div>
      )}

      {s?.summary && <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-zinc-600">{s.summary}</p>}

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <select
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          value={p.pursuit ?? "considering"}
          onChange={(e) => onPursuit(p.id, e.target.value as PursuitStatus)}
          aria-label="Pursuit status"
        >
          {PURSUIT.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-3">
          <a href={p.url} target="_blank" rel="noreferrer" className="text-zinc-400 hover:text-zinc-700" title="Program website">
            <ExternalLink size={14} />
          </a>
          <Link to={`/projects/${projectId}/programs/${p.id}`} className="flex items-center gap-1 text-xs font-medium text-indigo-700 hover:text-indigo-900">
            Rule breakdown <ArrowUpRight size={13} />
          </Link>
        </div>
      </div>
    </Card>
  );
}

const ELIGIBLE = "#2a78d6"; // series-1
const INELIGIBLE = "#86b6ef"; // same hue, step 250 (ordinal-safe on light)

export function FitChart({ items }: { items: ScoredProgram[] }) {
  const data = items
    .filter((i) => i.score)
    .map((i) => ({
      name: i.program.shortName || i.program.name,
      fit: Math.round(i.score!.fitScore),
      eligible: i.score!.eligible,
      award: i.score!.estimatedAward,
      thresholds: `${i.score!.thresholdsPassed}/${i.score!.thresholdsTotal}`,
    }));
  if (!data.length) return null;
  const height = Math.max(160, data.length * 34 + 40);

  return (
    <Card>
      <CardHeader
        title="Fit score by program"
        subtitle="0–100 blend of threshold eligibility and competitive points"
        right={
          <div className="flex items-center gap-3 text-[11px] text-zinc-600">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: ELIGIBLE }} /> Eligible
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: INELIGIBLE, backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,.7) 0 2px, transparent 2px 5px)" }} /> Not eligible
            </span>
          </div>
        }
      />
      <div className="px-3 py-4">
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 8 }} barCategoryGap={8}>
            <defs>
              <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="5" height="5" fill={INELIGIBLE} />
                <line x1="0" y1="0" x2="0" y2="5" stroke="rgba(255,255,255,.7)" strokeWidth="2" />
              </pattern>
            </defs>
            <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--viz-axis)" }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 12, fill: "#3f3f46" }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: "rgba(0,0,0,0.035)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof data)[number];
                return (
                  <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg">
                    <div className="font-semibold text-zinc-900">{d.name}</div>
                    <div className="tnum mt-1 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-zinc-600">
                      <span>Fit score</span>
                      <span className="text-right font-medium text-zinc-900">{d.fit}</span>
                      <span>Thresholds</span>
                      <span className="text-right font-medium text-zinc-900">{d.thresholds}</span>
                      <span>Est. award</span>
                      <span className="text-right font-medium text-zinc-900">{money(d.award)}</span>
                      <span>Status</span>
                      <span className="text-right font-medium text-zinc-900">{d.eligible ? "Eligible" : "Not eligible"}</span>
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="fit" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.eligible ? ELIGIBLE : "url(#hatch)"} />
              ))}
              <LabelList dataKey="fit" position="right" style={{ fontSize: 11, fill: "#52514e", fontVariantNumeric: "tabular-nums" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
