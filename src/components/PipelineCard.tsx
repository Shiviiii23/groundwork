import clsx from "clsx";
import { Database, FileText, Sparkles, Zap } from "lucide-react";
import type { PipelineSection, PipelineStats } from "@shared/types";
import { pageRanges, tokens, usd } from "../lib/format";
import { Pill } from "./ui";

type PageState = 0 | 1 | 2; // 0 = skipped, 1 = relevant (read), 2 = reused from cache

const RUN_CLASS: Record<1 | 2, string> = { 1: "bg-indigo-500", 2: "bar-cached" };
const STATE_LABEL = ["skipped", "read by extraction", "reused from library"];

/**
 * Page map of a document: a thin track for skipped pages with full-height runs for pages the
 * pipeline read (accent) or served from the rule library (hatched emerald). Runs are positioned
 * by percentage so it stays accurate at any width and page count.
 */
export function PageStrip({
  pageCount,
  relevantPages,
  sections = [],
  height = 28,
  labels = true,
}: {
  pageCount: number;
  relevantPages: number[];
  sections?: PipelineSection[];
  height?: number;
  labels?: boolean;
}) {
  if (!pageCount) return null;
  const state = new Array<PageState>(pageCount).fill(0);
  for (const p of relevantPages) if (p >= 1 && p <= pageCount) state[p - 1] = 1;
  for (const s of sections) {
    if (!s.cached) continue;
    for (let p = Math.max(1, s.pages[0]); p <= s.pages[1] && p <= pageCount; p++) state[p - 1] = 2;
  }

  const runs: { state: 1 | 2; from: number; to: number }[] = [];
  for (let i = 0; i < pageCount; i++) {
    const st = state[i];
    if (!st) continue;
    const last = runs[runs.length - 1];
    if (last && last.state === st && last.to === i) last.to = i + 1;
    else runs.push({ state: st, from: i + 1, to: i + 1 });
  }

  return (
    <div>
      <div className="relative w-full" style={{ height }} role="img" aria-label={`${relevantPages.length} of ${pageCount} pages read`}>
        <div className="absolute inset-x-0 top-1/2 h-[40%] -translate-y-1/2 rounded-sm bg-zinc-200" title={`${pageCount} pages · grey = skipped`} />
        {runs.map((r, i) => (
          <div
            key={i}
            className={clsx("absolute inset-y-0 rounded-[2px]", RUN_CLASS[r.state])}
            style={{ left: `${((r.from - 1) / pageCount) * 100}%`, width: `max(3px, ${((r.to - r.from + 1) / pageCount) * 100}%)` }}
            title={`${r.from === r.to ? `p. ${r.from}` : `pp. ${r.from}–${r.to}`} · ${STATE_LABEL[r.state]}`}
          />
        ))}
      </div>
      {labels && sections.length > 0 && (
        <div className="relative mt-1 h-4">
          {visibleLabels(sections, pageCount).map((s, i) => (
            <span
              key={i}
              className={clsx("tnum absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10px]", s.cached ? "text-emerald-700" : "text-indigo-700")}
              style={{ left: `${Math.min(94, Math.max(6, (((s.pages[0] + s.pages[1]) / 2 - 0.5) / pageCount) * 100))}%` }}
            >
              {s.pages[0] === s.pages[1] ? s.pages[0] : `${s.pages[0]}–${s.pages[1]}`}
            </span>
          ))}
        </div>
      )}
      <div className="mt-1 flex justify-between text-[10px] text-zinc-400">
        <span>p. 1</span>
        <span>p. {pageCount}</span>
      </div>
    </div>
  );
}

/** Drops section labels that would overlap the previous one (labels are ~10% of the strip wide). */
function visibleLabels(sections: PipelineSection[], pageCount: number): PipelineSection[] {
  const out: PipelineSection[] = [];
  let lastPos = -Infinity;
  for (const s of [...sections].sort((a, b) => a.pages[0] - b.pages[0])) {
    const pos = ((s.pages[0] + s.pages[1]) / 2 / pageCount) * 100;
    if (pos - lastPos < 12) continue;
    out.push(s);
    lastPos = pos;
  }
  return out;
}

export function CacheBadge({ hit }: { hit: PipelineStats["cacheHit"] }) {
  if (hit === "full")
    return (
      <Pill tone="good" icon={<Database size={11} />}>
        From library · $0
      </Pill>
    );
  if (hit === "partial")
    return (
      <Pill tone="info" icon={<Database size={11} />}>
        Partial reuse
      </Pill>
    );
  return (
    <Pill tone="accent" icon={<Sparkles size={11} />}>
      Fresh extraction
    </Pill>
  );
}

/** One-line summary for a collapsed task row: "312 pp → 24 relevant · $0.41 · saved ~$5.70". */
export function pipelineSummary(p: PipelineStats): string {
  const parts = [`${p.pageCount} pp → ${p.relevantPages.length} relevant`];
  if (p.llmSkipped) parts.push("local pass only");
  else parts.push(p.cacheHit === "full" ? "from library" : usd(p.costUsd));
  if (p.savedUsdEst > 0.005) parts.push(`saved ~${usd(p.savedUsdEst)}`);
  return parts.join(" · ");
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div>
      <div className="label !text-[10px]">{label}</div>
      <div className={clsx("tnum mt-0.5 text-sm font-semibold", tone === "good" ? "text-emerald-700" : "text-zinc-900")}>{value}</div>
    </div>
  );
}

export default function PipelineCard({ p }: { p: PipelineStats }) {
  const readPct = p.pageCount ? p.relevantPages.length / p.pageCount : 0;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileText size={15} className="shrink-0 text-zinc-400" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-zinc-900">{p.sourceName}</div>
            <div className="tnum text-[11px] text-zinc-500">
              {p.pageCount} pages · ~{tokens(p.docTokensEst)} tokens · read {(readPct * 100).toFixed(0)}%
            </div>
          </div>
        </div>
        <CacheBadge hit={p.cacheHit} />
      </div>

      {p.llmSkipped && (
        <div className="mt-3 rounded-md bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          Claude disabled — local page selection only. Set ANTHROPIC_API_KEY to extract rules.
        </div>
      )}

      <div className="mt-3">
        <PageStrip pageCount={p.pageCount} relevantPages={p.relevantPages} sections={p.sections} />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-1.5 rounded-[1px] bg-indigo-500" /> Read by extraction
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bar-cached inline-block h-2.5 w-1.5 rounded-[1px]" /> Reused from library
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-[1px] bg-zinc-200" /> Skipped
        </span>
      </div>

      <div className="tnum mt-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded-md bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600">
        <span>Keyword pass: kept {p.keywordKept}</span>
        <span>Dropped {p.keywordDropped}</span>
        <span>
          Triage: {p.triageKept}/{p.triaged} kept
        </span>
        <span>
          {p.sections.length} section{p.sections.length === 1 ? "" : "s"}
          {p.sections.some((s) => s.cached) ? ` (${p.sections.filter((s) => s.cached).length} cached)` : ""}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2.5">
        <Stat label="AI calls" value={String(p.llmCalls)} />
        <Stat label="Tokens in/out" value={`${tokens(p.inputTokens)} / ${tokens(p.outputTokens)}`} />
        <Stat label="Cost" value={usd(p.costUsd)} />
        <Stat label="Full read est." value={usd(p.fullReadCostUsdEst)} />
        <Stat label="Saved" value={`~${usd(p.savedUsdEst)}`} tone="good" />
        <Stat label="Duration" value={`${(p.durationMs / 1000).toFixed(1)}s`} />
      </div>

      {p.relevantPages.length > 0 && (
        <div className="mt-3 flex items-start gap-1.5 text-[11px] text-zinc-500">
          <Zap size={12} className="mt-0.5 shrink-0 text-indigo-500" />
          <span>
            Pages read: <span className="tnum font-mono text-zinc-700">{pageRanges(p.relevantPages)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
