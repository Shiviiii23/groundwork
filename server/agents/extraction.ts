import type { FundingProgram, PipelineStats } from "../../shared/types";
import { library, rehydrate, sourceKeyFor, type CachedRules } from "../docs/library";
import { costOf, usageFrom } from "../docs/models";
import { NeedsLlmError, ranges, runDocumentPipeline, type PipelineInput } from "../docs/pipeline";
import { extractRules, llmEnabled, MODEL } from "../llm";
import type { Agent, AgentCtx } from "./context";

// Web-researched rules (no fetchable document) are reused from the library for this long.
const WEB_CACHE_DAYS = 90;
const PROGRAM_CONCURRENCY = 3;

function ruleBreakdown(p: FundingProgram): string {
  const t = p.rules.filter((r) => r.kind === "threshold").length;
  const pts = p.rules.filter((r) => r.kind === "points");
  const max = pts.reduce((s, r) => s + (r.maxPoints ?? 0), 0);
  return `${t} threshold${t === 1 ? "" : "s"}, ${pts.length} scoring criteria (${max} pts), ${p.complianceRules.length} compliance obligations`;
}

/** Copies cached rules and (for uploaded documents) program metadata onto a project program. */
function apply(prog: FundingProgram, cached: CachedRules, stats: PipelineStats) {
  Object.assign(prog, rehydrate(prog.id, cached));
  prog.extraction = {
    sourceKey: stats.sourceKey,
    docHash: stats.docHash,
    relevantPages: stats.relevantPages,
    pageCount: stats.pageCount,
    cacheHit: stats.cacheHit,
    extractedAt: new Date().toISOString(),
  };
  const m = cached.program;
  if (prog.discoveredBy === "uploaded_document" && m) {
    Object.assign(prog, {
      name: m.name || prog.name,
      shortName: (m.shortName || prog.shortName).slice(0, 24),
      administrator: m.administrator || prog.administrator,
      jurisdiction: m.jurisdiction || prog.jurisdiction,
      type: m.type || prog.type,
      awardType: m.awardType || prog.awardType,
      description: m.description || prog.description,
      typicalAward: m.typicalAward || prog.typicalAward,
      applicationCycle: m.applicationCycle || prog.applicationCycle,
    });
  }
}

/** Runs the document pipeline for one program, narrating into the agent's step log. */
export async function extractDocumentInto(ctx: AgentCtx, prog: FundingProgram, input: PipelineInput): Promise<PipelineStats> {
  const label = prog.shortName;
  try {
    const res = await runDocumentPipeline(input, {
      step: (level, message, detail) => ctx.step(level, `${label}: ${message}`, detail),
      progress: () => {},
    });
    apply(prog, res, res.stats);
    (ctx.task.pipelines ??= []).push(res.stats);
    return res.stats;
  } catch (err) {
    if (err instanceof NeedsLlmError) (ctx.task.pipelines ??= []).push(err.stats);
    throw err;
  }
}

/** Last resort for discovered programs with no fetchable document: Claude researches the program on the web. */
async function webResearch(ctx: AgentCtx, prog: FundingProgram, key: string): Promise<void> {
  ctx.step("tool", `${prog.shortName}: no fetchable document — Claude researching program on the web`, prog.url);
  const started = Date.now();
  const res = await extractRules("", { name: prog.name, administrator: prog.administrator, url: prog.url });
  const usage = res.usage.map((u) => usageFrom(MODEL, u));
  const costUsd = usage.reduce((s, u) => s + costOf(u), 0);
  const stats: PipelineStats = {
    sourceKey: key, sourceName: prog.name, docHash: `web:${key}`, pageCount: 0, docTokensEst: 0, cacheHit: "none",
    keywordKept: 0, keywordDropped: 0, triaged: 0, triageKept: 0, relevantPages: [], sections: [],
    llmCalls: usage.length, inputTokens: usage.reduce((s, u) => s + u.inputTokens, 0), outputTokens: usage.reduce((s, u) => s + u.outputTokens, 0),
    cacheReadTokens: usage.reduce((s, u) => s + u.cacheReadTokens, 0), costUsd, fullReadCostUsdEst: costUsd, savedUsdEst: 0, durationMs: Date.now() - started,
  };
  const cached: CachedRules = { program: { ...res.program }, rules: res.rules, complianceRules: res.complianceRules };
  library.addVersion(key, { name: prog.name, administrator: prog.administrator, url: prog.url }, {
    ...cached, docHash: stats.docHash, title: `${prog.name} (web research)`, url: prog.url, pageCount: 0,
    extractedAt: new Date().toISOString(), ruleCount: res.rules.length, complianceCount: res.complianceRules.length, relevantPages: [], stats,
  });
  apply(prog, cached, stats);
  (ctx.task.pipelines ??= []).push(stats);
  if (res.dropped) ctx.step("warn", `${prog.shortName}: dropped ${res.dropped} rule${res.dropped === 1 ? "" : "s"} not expressible in the scoring DSL`);
}

async function extractDiscovered(ctx: AgentCtx, prog: FundingProgram): Promise<void> {
  const docUrl = prog.sourceDocument.url || prog.url;
  const key = sourceKeyFor(docUrl || prog.name);

  // 1. Rule library: another project already paid for this source.
  const cached = library.latest(key);
  const fresh = cached && Date.now() - Date.parse(cached.extractedAt) < WEB_CACHE_DAYS * 864e5;
  if (cached && fresh) {
    const saved = cached.stats.fullReadCostUsdEst || cached.stats.costUsd;
    library.recordHit(key, saved);
    const stats: PipelineStats = { ...cached.stats, cacheHit: "full", llmCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, savedUsdEst: saved, durationMs: 0 };
    apply(prog, cached, stats);
    (ctx.task.pipelines ??= []).push(stats);
    ctx.step("result", `${prog.shortName}: rule library hit — ${cached.rules.length} rules reused, no AI calls`, cached.pageCount ? `pages ${ranges(cached.relevantPages)} of ${cached.pageCount}` : "from earlier web research");
    return;
  }
  if (!llmEnabled()) throw new Error("not in the rule library and AI extraction is disabled");

  // 2. Fetch the program's document and run the page-selective pipeline.
  if (docUrl) {
    try {
      await extractDocumentInto(ctx, prog, { title: prog.sourceDocument.title || prog.name, sourceName: prog.name, sourceKey: key, url: docUrl, administrator: prog.administrator });
      return;
    } catch (err) {
      ctx.step("warn", `${prog.shortName}: couldn't use ${docUrl} (${(err as Error).message})`);
    }
  }
  // 3. Fall back to web research.
  await webResearch(ctx, prog, key);
}

export const extractionAgent: Agent = async (ctx) => {
  const programs = ctx.project.programs;
  const pending = programs.filter((p) => p.rules.length === 0);
  for (const prog of programs.filter((p) => p.rules.length > 0)) {
    ctx.step("tool", `Reading ${prog.sourceDocument.title}`, prog.sourceDocument.url);
    await ctx.pause(100, 250);
    ctx.step("result", `${prog.shortName}: ${ruleBreakdown(prog)}`);
  }
  ctx.progress(pending.length ? 30 : 100);

  // Discovered programs are independent, so extract them in parallel.
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(PROGRAM_CONCURRENCY, pending.length) }, async () => {
      while (next < pending.length) {
        const prog = pending[next++];
        try {
          await extractDiscovered(ctx, prog);
          ctx.step("result", `${prog.shortName}: ${ruleBreakdown(prog)}`);
        } catch (err) {
          ctx.step(err instanceof NeedsLlmError ? "warn" : "error", `${prog.shortName}: ${(err as Error).message}`);
        }
        ctx.progress(30 + (++done / pending.length) * 70);
        ctx.saveProject();
      }
    }),
  );

  // Programs that ended up with no rules can't be scored.
  ctx.project.programs = programs.filter((p) => p.rules.length > 0);
  ctx.saveProject();
  const total = ctx.project.programs.reduce((s, p) => s + p.rules.length, 0);
  const comp = ctx.project.programs.reduce((s, p) => s + p.complianceRules.length, 0);
  const pipes = ctx.task.pipelines ?? [];
  const spent = pipes.reduce((s, p) => s + p.costUsd, 0);
  const saved = pipes.reduce((s, p) => s + Math.max(0, p.savedUsdEst), 0);
  const money = pipes.length ? ` · AI spend $${spent.toFixed(2)}, saved ~$${saved.toFixed(2)}` : "";
  return `${total} rules and ${comp} compliance obligations across ${ctx.project.programs.length} programs${money}`;
};

