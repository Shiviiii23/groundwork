import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, COMMON, EXTRACTION_SCHEMA, EXTRACTION_SYSTEM, finalText, MODEL, runToCompletion, type RawExtraction } from "../llm";

/** Cheap model used to triage ambiguous pages. Override with GROUNDWORK_TRIAGE_MODEL. */
export const TRIAGE_MODEL = process.env.GROUNDWORK_TRIAGE_MODEL || "claude-haiku-5-5";
const EXTRACT_EFFORT = (process.env.GROUNDWORK_EXTRACT_EFFORT || "medium") as "low" | "medium" | "high";

// USD per million tokens. Unknown models fall back to the extraction-model rates (over-estimates, never under).
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};
const priceOf = (model: string) => PRICES[model] ?? PRICES["claude-opus-5-5"];

export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function usageFrom(model: string, u: Pick<Anthropic.Messages.Usage, "input_tokens" | "output_tokens"> & { cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): Usage {
  return {
    model,
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

export function costOf(u: Usage): number {
  const p = priceOf(u.model);
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1e6;
}

/** What sending the whole document to the extraction model in one pass would cost (input + the same output). */
export function fullReadCost(docTokens: number, outputTokens: number): number {
  const p = priceOf(MODEL);
  return (docTokens * p.input + Math.max(outputTokens, 6000) * p.output) / 1e6;
}

// ───────────────────────── Triage ─────────────────────────

export interface TriagePage {
  page: number;
  excerpt: string;
}

const TRIAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pages"],
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["page", "relevant"],
        properties: { page: { type: "integer" }, relevant: { type: "boolean" } },
      },
    },
  },
};

async function sdkTriage(programName: string, pages: TriagePage[]): Promise<{ relevant: Set<number>; usage: Usage }> {
  const body = pages.map((p) => `<page n="${p.page}">\n${p.excerpt}\n</page>`).join("\n");
  const msg = await anthropic().messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 4000,
    output_config: { effort: "low", format: { type: "json_schema", schema: TRIAGE_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `These are page excerpts from a funding document for "${programName}" (an affordable-housing QAP, NOFA or program guideline).

Mark a page relevant if it states eligibility requirements, threshold criteria, competitive scoring/points, income or rent targeting, set-asides, cost or subsidy limits, site/amenity criteria, readiness requirements, or post-award compliance obligations. Mark it NOT relevant if it is a table of contents, cover/letter, definitions-only glossary, application form or exhibit to fill in, certification/signature page, procedural submission instructions, contact info, or narrative background.

${body}

Return a verdict for every page number.`,
      },
    ],
  });
  if (msg.stop_reason === "refusal") throw new Error("Triage model declined the request");
  const parsed = JSON.parse(finalText(msg as never)) as { pages: { page: number; relevant: boolean }[] };
  return { relevant: new Set(parsed.pages.filter((p) => p.relevant).map((p) => p.page)), usage: usageFrom(TRIAGE_MODEL, msg.usage) };
}

// ───────────────────────── Section extraction ─────────────────────────

export interface SectionRequest {
  programName: string;
  administrator?: string;
  docTitle: string;
  pageCount: number;
  pages: [number, number];
  text: string; // the section's pages, each wrapped in <page n="…">
  opening?: string; // first page(s) of the document, for program metadata
}

async function sdkExtract(req: SectionRequest): Promise<{ raw: RawExtraction; usage: Usage }> {
  const msg = await runToCompletion({
    ...COMMON,
    max_tokens: 32000,
    // The system prompt (DSL + field list) is identical across sections and documents, so cache it.
    system: [{ type: "text", text: EXTRACTION_SYSTEM, cache_control: { type: "ephemeral" } }],
    output_config: { effort: EXTRACT_EFFORT, format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Program: ${req.programName}${req.administrator ? ` (${req.administrator})` : ""}
Document: ${req.docTitle} (${req.pageCount} pages)
${req.opening ? `\n<document_opening>\n${req.opening}\n</document_opening>\n` : ""}
You are given pages ${req.pages[0]}–${req.pages[1]} only; other relevant sections are processed separately, so extract ONLY rules stated in these pages and do not invent rules from general knowledge. Include the page in each citation (e.g. "§10325(c)(5), p. ${req.pages[0]}"). Fill the program metadata as best these pages allow.

<pages>
${req.text}
</pages>`,
      },
    ],
  });
  return { raw: JSON.parse(finalText(msg)) as RawExtraction, usage: usageFrom(MODEL, msg.usage) };
}

// ───────────────────────── Injection point (tests) ─────────────────────────

export interface ModelCalls {
  triage(programName: string, pages: TriagePage[]): Promise<{ relevant: Set<number>; usage: Usage }>;
  extract(req: SectionRequest): Promise<{ raw: RawExtraction; usage: Usage }>;
}

let calls: ModelCalls = { triage: sdkTriage, extract: sdkExtract };
export const models = (): ModelCalls => calls;
/** Swap the model layer (used by the pipeline self-test to run without an API key). */
export function setModelCalls(override: Partial<ModelCalls>): void {
  calls = { ...calls, ...override };
}
