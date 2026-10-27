import type { ComplianceRule, DocumentSourceInput, PipelineSection, PipelineStats, Rule } from "../../shared/types";
import { llmEnabled, normalizeExtraction } from "../llm";
import { ingest, sha, tokensEst, type DocPage, type IngestedDoc } from "./ingest";
import { library, sourceKeyFor, type CachedRules, type ProgramMeta } from "./library";
import { costOf, fullReadCost, models, type Usage } from "./models";
import { scorePages, toSections } from "./relevance";

export interface PipelineHooks {
  step(level: "info" | "tool" | "result" | "warn", message: string, detail?: string): void;
  progress(pct: number): void;
}

export interface PipelineResult extends CachedRules {
  stats: PipelineStats;
}

/** Thrown when Claude is needed but disabled; carries the free local-pass stats for display. */
export class NeedsLlmError extends Error {
  constructor(public stats: PipelineStats) {
    super("Claude is disabled (set ANTHROPIC_API_KEY) — showing the free page selection only; rules were not extracted");
  }
}

const TRIAGE_BATCH = 20;
const TRIAGE_EXCERPT = 1500;
const CONCURRENCY = 4;
const ESTIMATED_TRIAGE_KEEP = 0.4; // used for previews before triage has run

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** "3, 7–9, 12" */
export function ranges(pages: number[]): string {
  const out: [number, number][] = [];
  for (const n of [...pages].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
}

const pageBlock = (pages: DocPage[]) => pages.map((p) => `<page n="${p.n}">\n${p.text}\n</page>`).join("\n");

function emptyStats(sourceKey: string, sourceName: string, doc: IngestedDoc): PipelineStats {
  return {
    sourceKey,
    sourceName,
    docHash: doc.hash,
    pageCount: doc.pages.length,
    docTokensEst: tokensEst(doc.chars),
    cacheHit: "none",
    keywordKept: 0,
    keywordDropped: 0,
    triaged: 0,
    triageKept: 0,
    relevantPages: [],
    sections: [],
    llmCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    fullReadCostUsdEst: fullReadCost(tokensEst(doc.chars), 0),
    savedUsdEst: 0,
    durationMs: 0,
  };
}

function dedupe<T extends { id: string; title: string }>(items: T[], better: (a: T, b: T) => boolean): T[] {
  const byTitle = new Map<string, T>();
  for (const it of items) {
    const key = it.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const prev = byTitle.get(key);
    if (!prev || better(it, prev)) byTitle.set(key, it);
  }
  // Model ids can collide across sections; make them unique and stable.
  const seen = new Map<string, number>();
  return [...byTitle.values()].map((it) => {
    const base = it.id.replace(/[^A-Za-z0-9_.-]+/g, "_") || "rule";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? it : { ...it, id: `${base}_${n}` };
  });
}

/** Free preview: ingest + local relevance pass + cache lookup. No model calls. */
export async function previewDocument(input: PipelineInput): Promise<PipelineStats> {
  if (input.libraryKey) {
    const v = library.latest(input.libraryKey);
    if (!v) throw new Error("Unknown rule library source");
    return { ...v.stats, cacheHit: "full", llmCalls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, savedUsdEst: v.stats.fullReadCostUsdEst, llmSkipped: true };
  }
  const doc = await ingest(input);
  const name = input.sourceName || input.title;
  const key = input.sourceKey ?? sourceKeyFor(name);
  const stats = emptyStats(key, name, doc);
  const hit = library.findDoc(doc.hash);
  if (hit) return { ...stats, sourceKey: hit.sourceKey, cacheHit: "full", relevantPages: hit.version.relevantPages, sections: hit.version.stats.sections.map((s) => ({ ...s, cached: true })), savedUsdEst: stats.fullReadCostUsdEst, llmSkipped: true };
  const scores = scorePages(doc.pages);
  const kept = scores.filter((s) => s.band === "keep").map((s) => s.n);
  const band = scores.filter((s) => s.band === "triage");
  // Expect roughly ESTIMATED_TRIAGE_KEEP of the ambiguous pages to survive triage.
  const likely = [...kept, ...band.sort((a, b) => b.score - a.score).slice(0, Math.round(band.length * ESTIMATED_TRIAGE_KEEP)).map((s) => s.n)];
  const sections = toSections(likely, doc.pages);
  const extractTokens = sections.reduce((s, [a, b]) => s + tokensEst(doc.pages.slice(a - 1, b).reduce((c, p) => c + p.text.length, 0)), 0);
  const triageTokens = band.length * tokensEst(TRIAGE_EXCERPT) + Math.ceil(band.length / TRIAGE_BATCH) * 400;
  const estCost = costOf({ model: "claude-haiku-5-5", inputTokens: triageTokens, outputTokens: band.length * 15, cacheReadTokens: 0, cacheWriteTokens: 0 }) + costOf({ model: "claude-opus-5-5", inputTokens: extractTokens + sections.length * 2500, outputTokens: sections.length * 2500, cacheReadTokens: 0, cacheWriteTokens: 0 });
  const partial = library.latest(key) ? "partial" : "none";
  // Compare like with like: a full read produces the same rules, so the same output volume.
  const fullRead = fullReadCost(stats.docTokensEst, sections.length * 2500);
  return {
    ...stats,
    fullReadCostUsdEst: fullRead,
    cacheHit: partial,
    keywordKept: kept.length,
    keywordDropped: scores.filter((s) => s.band === "drop").length,
    triaged: band.length,
    relevantPages: likely.sort((a, b) => a - b),
    sections: sections.map(([a, b]) => ({ pages: [a, b], tokensEst: tokensEst(doc.pages.slice(a - 1, b).reduce((c, p) => c + p.text.length, 0)), cached: false, rules: 0 })),
    costUsd: estCost,
    savedUsdEst: fullRead - estCost,
    llmSkipped: true,
  };
}

/**
 * Turns a long funding document into rules while reading as little of it as possible:
 * library hit → local relevance pass → cheap triage of ambiguous pages → parallel extraction of
 * relevant sections (reusing cached sections) → merge → cache.
 */
export type PipelineInput = DocumentSourceInput & { administrator?: string; sourceKey?: string };

export async function runDocumentPipeline(input: PipelineInput, hooks: PipelineHooks): Promise<PipelineResult> {
  const started = Date.now();

  // 0. Explicit library reuse.
  if (input.libraryKey) {
    const v = library.latest(input.libraryKey);
    if (!v) throw new Error("Unknown rule library source");
    hooks.step("result", `Rule library hit: ${v.title} — ${v.rules.length} rules reused, no AI calls`, `pages used: ${ranges(v.relevantPages)} of ${v.pageCount}`);
    library.recordHit(input.libraryKey, v.stats.fullReadCostUsdEst);
    hooks.progress(100);
    return { program: v.program, rules: v.rules, complianceRules: v.complianceRules, stats: { ...v.stats, sections: v.stats.sections.map((s) => ({ ...s, cached: true })), cacheHit: "full", llmCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, savedUsdEst: v.stats.fullReadCostUsdEst, durationMs: Date.now() - started } };
  }

  // 1. Ingest.
  hooks.step("tool", `Parsing "${input.title}"`, input.url ?? (input.pdfBase64 ? "uploaded PDF" : "pasted text"));
  const doc = await ingest(input);
  const name = input.sourceName || input.title;
  let key = input.sourceKey ?? sourceKeyFor(name);
  const stats = emptyStats(key, name, doc);
  hooks.step("result", `${doc.pages.length} pages · ~${stats.docTokensEst.toLocaleString()} tokens (reading it all would cost ~$${stats.fullReadCostUsdEst.toFixed(2)})`);
  hooks.progress(10);

  // 2. Whole-document cache hit.
  const hit = library.findDoc(doc.hash);
  if (hit) {
    const v = hit.version;
    if (hit.sourceKey !== key) hooks.step("info", `Identical document already in the library as "${hit.sourceKey}"`);
    hooks.step("result", `Rule library hit (document fingerprint ${doc.hash.slice(0, 8)}) — ${v.rules.length} rules reused, no AI calls`, `pages used: ${ranges(v.relevantPages)}`);
    library.recordHit(hit.sourceKey, stats.fullReadCostUsdEst);
    hooks.progress(100);
    return {
      program: v.program,
      rules: v.rules,
      complianceRules: v.complianceRules,
      stats: { ...v.stats, sourceKey: hit.sourceKey, sourceName: name, cacheHit: "full", sections: v.stats.sections.map((s) => ({ ...s, cached: true })), llmCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, fullReadCostUsdEst: stats.fullReadCostUsdEst, savedUsdEst: stats.fullReadCostUsdEst, durationMs: Date.now() - started },
    };
  }
  if (library.latest(key)) hooks.step("info", `New edition of a cached source — unchanged sections will be reused`);

  // 3. Free local relevance pass.
  const scores = scorePages(doc.pages);
  const kept = scores.filter((s) => s.band === "keep").map((s) => s.n);
  const band = scores.filter((s) => s.band === "triage");
  stats.keywordKept = kept.length;
  stats.keywordDropped = scores.filter((s) => s.band === "drop").length;
  stats.triaged = band.length;
  hooks.step("result", `Keyword pass: ${kept.length} pages clearly relevant, ${stats.keywordDropped} dropped (TOC, forms, boilerplate), ${band.length} ambiguous`, kept.length ? `kept: ${ranges(kept)}` : undefined);
  hooks.progress(20);

  if (!llmEnabled()) {
    stats.relevantPages = kept;
    stats.llmSkipped = true;
    stats.durationMs = Date.now() - started;
    throw new NeedsLlmError(stats);
  }

  const usages: Usage[] = [];

  // 4. Triage the ambiguous band with the cheap model (verdicts cached per page).
  const verdicts = new Map<number, boolean>();
  const toAsk = band.filter((s) => {
    const cached = library.triage(key, doc.pages[s.n - 1].hash);
    if (cached !== undefined) verdicts.set(s.n, cached);
    return cached === undefined;
  });
  if (toAsk.length) {
    const batches: number[][] = [];
    for (let i = 0; i < toAsk.length; i += TRIAGE_BATCH) batches.push(toAsk.slice(i, i + TRIAGE_BATCH).map((s) => s.n));
    hooks.step("tool", `Triage: ${toAsk.length} ambiguous pages → cheap model in ${batches.length} batch${batches.length === 1 ? "" : "es"}${verdicts.size ? ` (${verdicts.size} verdicts cached)` : ""}`);
    await pool(batches, CONCURRENCY, async (nums) => {
      const res = await models().triage(name, nums.map((n) => ({ page: n, excerpt: doc.pages[n - 1].text.slice(0, TRIAGE_EXCERPT) })));
      usages.push(res.usage);
      const fresh: Record<string, boolean> = {};
      for (const n of nums) {
        verdicts.set(n, res.relevant.has(n));
        fresh[doc.pages[n - 1].hash] = res.relevant.has(n);
      }
      library.setTriage(key, fresh);
    });
  }
  const triageKept = band.filter((s) => verdicts.get(s.n)).map((s) => s.n);
  stats.triageKept = triageKept.length;
  if (band.length) hooks.step("result", `Triage kept ${triageKept.length} of ${band.length} ambiguous pages`);
  hooks.progress(35);

  // 5. Sections.
  const relevant = [...kept, ...triageKept].sort((a, b) => a - b);
  if (!relevant.length) throw new Error("No pages in this document look like program rules");
  const sectionRanges = toSections(relevant, doc.pages);
  stats.relevantPages = relevant;
  const sections = sectionRanges.map(([a, b]) => {
    const pages = doc.pages.slice(a - 1, b);
    const hash = sha(pages.map((p) => p.hash).join(":"));
    return { range: [a, b] as [number, number], pages, hash, cached: library.section(key, hash) };
  });
  const reused = sections.filter((s) => s.cached).length;
  hooks.step(
    "result",
    `${relevant.length} of ${doc.pages.length} pages relevant → ${sections.length} section${sections.length === 1 ? "" : "s"}${reused ? ` (${reused} unchanged, reused from library)` : ""}`,
    `pages ${ranges(relevant)}`,
  );

  // 6. Extract uncached sections in parallel. The first goes alone so the shared system prompt is cached for the rest.
  const opening = doc.pages.slice(0, 2).map((p) => p.text).join("\n").slice(0, 3000);
  const todo = sections.filter((s) => !s.cached);
  let done = 0;
  const extractOne = async (s: (typeof sections)[number]) => {
    hooks.step("tool", `Extracting pages ${s.range[0]}–${s.range[1]} (~${tokensEst(s.pages.reduce((c, p) => c + p.text.length, 0)).toLocaleString()} tokens)`);
    const res = await models().extract({ programName: name, administrator: input.administrator, docTitle: doc.title, pageCount: doc.pages.length, pages: s.range, text: pageBlock(s.pages), opening: s.range[0] > 2 ? opening : undefined });
    usages.push(res.usage);
    const norm = normalizeExtraction(res.raw, "", `${doc.title}, pp. ${s.range[0]}–${s.range[1]}`);
    s.cached = { program: norm.program as ProgramMeta, rules: norm.rules, complianceRules: norm.complianceRules, costUsd: costOf(res.usage), at: new Date().toISOString() };
    library.setSection(key, s.hash, s.cached);
    if (norm.dropped) hooks.step("warn", `Pages ${s.range[0]}–${s.range[1]}: dropped ${norm.dropped} rule${norm.dropped === 1 ? "" : "s"} not expressible in the scoring DSL`);
    hooks.progress(35 + (++done / todo.length) * 55);
  };
  if (todo.length) {
    await extractOne(todo[0]);
    await pool(todo.slice(1), CONCURRENCY, extractOne);
  }

  // 7. Merge sections.
  const results = sections.map((s) => s.cached!);
  const program = results.find((r) => r.program?.name)?.program ?? ({ name } as ProgramMeta);
  const rules = dedupe<Rule>(results.flatMap((r) => r.rules), (a, b) => (a.maxPoints ?? 0) > (b.maxPoints ?? 0) || a.description.length > b.description.length);
  const complianceRules = dedupe<ComplianceRule>(results.flatMap((r) => r.complianceRules), (a, b) => a.description.length > b.description.length);

  // 8. Stats + cache.
  for (const u of usages) {
    stats.inputTokens += u.inputTokens + u.cacheWriteTokens;
    stats.outputTokens += u.outputTokens;
    stats.cacheReadTokens += u.cacheReadTokens;
    stats.costUsd += costOf(u);
  }
  stats.llmCalls = usages.length;
  stats.cacheHit = reused ? "partial" : "none";
  const extractOut = usages.filter((u) => u.model !== "claude-haiku-5-5").reduce((s, u) => s + u.outputTokens, 0);
  stats.fullReadCostUsdEst = fullReadCost(stats.docTokensEst, extractOut);
  stats.savedUsdEst = stats.fullReadCostUsdEst - stats.costUsd;
  stats.sections = sections.map<PipelineSection>((s) => ({
    pages: s.range,
    tokensEst: tokensEst(s.pages.reduce((c, p) => c + p.text.length, 0)),
    cached: !todo.includes(s),
    rules: s.cached!.rules.length,
  }));
  stats.durationMs = Date.now() - started;
  key = stats.sourceKey;
  library.addVersion(key, { name, administrator: input.administrator ?? program.administrator, url: input.url }, {
    docHash: doc.hash,
    title: doc.title,
    url: input.url,
    pageCount: doc.pages.length,
    extractedAt: new Date().toISOString(),
    ruleCount: rules.length,
    complianceCount: complianceRules.length,
    relevantPages: relevant,
    stats,
    program,
    rules,
    complianceRules,
  });
  hooks.step(
    "result",
    `${rules.length} rules + ${complianceRules.length} compliance obligations · ${stats.llmCalls} AI calls · $${stats.costUsd.toFixed(2)} (vs ~$${stats.fullReadCostUsdEst.toFixed(2)} reading everything) · cached in rule library`,
  );
  hooks.progress(100);
  return { program, rules, complianceRules, stats };
}
