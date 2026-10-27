import Anthropic from "@anthropic-ai/sdk";
import type {
  AmenityType,
  AwardType,
  ComplianceCheckKind,
  ComplianceRule,
  ProgramType,
  ProjectInput,
  Rule,
  RuleCheck,
} from "../shared/types";
import { CUSTOM_CHECKS, describeDslForLLM } from "./engine/evaluate";

export const MODEL = process.env.GROUNDWORK_MODEL || "claude-opus-5-5";

/** Claude features run only when real credentials exist (a base URL alone is not enough). */
export function llmEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

// Server-side refusal fallback: routes a declined request to the server-defined default fallback model.
export const COMMON = {
  model: MODEL,
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default" as const,
  thinking: { type: "adaptive" as const },
};

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** Streams a request to completion, resuming on pause_turn (long server-tool loops). */
export async function runToCompletion(params: Omit<BetaParams, "stream">, maxContinuations = 4): Promise<BetaMessage> {
  const messages = [...params.messages];
  for (let i = 0; ; i++) {
    const msg = await anthropic().beta.messages.stream({ ...params, messages }).finalMessage();
    if (msg.stop_reason === "refusal") {
      throw new Error(`Claude declined the request${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ""}`);
    }
    if (msg.stop_reason === "pause_turn" && i < maxContinuations) {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    return msg;
  }
}

export function finalText(msg: BetaMessage): string {
  return msg.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Pulls the last JSON object/array out of model text, tolerating ``` fences and prose around it. */
export function parseJsonLoose<T>(text: string): T {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = fenced.length ? fenced.reverse() : [text];
  for (const c of candidates) {
    const start = c.search(/[[{]/);
    if (start < 0) continue;
    const open = c[start];
    const end = c.lastIndexOf(open === "[" ? "]" : "}");
    if (end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1)) as T;
    } catch {
      /* try next */
    }
  }
  throw new Error("No JSON found in model response");
}

// ───────────────────────── Discovery ─────────────────────────

export interface DiscoveredProgram {
  name: string;
  shortName: string;
  administrator: string;
  jurisdiction: string;
  type: ProgramType;
  awardType: AwardType;
  description: string;
  typicalAward: string;
  applicationCycle: string;
  url: string;
  sourceDocument: { title: string; url: string; year?: number };
}

const PROGRAM_TYPES: ProgramType[] = ["federal_tax_credit", "federal_grant", "federal_loan", "state_program", "local_program", "private"];
const AWARD_TYPES: AwardType[] = ["tax_credit", "grant", "soft_loan", "loan_insurance", "bond"];

export async function discoverPrograms(input: ProjectInput, alreadyKnown: string[]): Promise<{ programs: DiscoveredProgram[]; searches: number }> {
  const units = input.unitMix.reduce((s, r) => s + r.count, 0);
  const prompt = `A developer is planning an affordable housing project and needs funding sources.

Project: ${input.name}
Location: ${input.address}, ${input.city}, ${input.state} ${input.zip}
Type: ${input.constructionType.replace("_", " ")}, ${units} units, population: ${input.targetPopulation}
Total development cost: $${input.totalDevelopmentCost.toLocaleString()}
Income targeting: ${input.unitMix.map((r) => `${r.count}× ${r.bedrooms}BR @ ${r.targetAmiPct}% AMI`).join(", ")}

We already track these programs, so do NOT return them: ${alreadyKnown.join("; ")}.

Search the web for currently active STATE, COUNTY, and CITY funding programs (soft loans, grants, gap financing, housing trust funds, bond programs, NOFAs) this project could apply to in ${input.city}, ${input.state}. Prefer official agency pages and the most recent NOFA/program guidelines. Return up to 6 of the most relevant.

Reply with ONLY a JSON array, each item:
{"name": str, "shortName": str (<=24 chars), "administrator": str, "jurisdiction": "${input.state}" or the city/county name, "type": one of ${JSON.stringify(PROGRAM_TYPES)}, "awardType": one of ${JSON.stringify(AWARD_TYPES)}, "description": str (2 sentences), "typicalAward": str, "applicationCycle": str, "url": str, "sourceDocument": {"title": str, "url": str, "year": number}}`;

  const msg = await runToCompletion({
    ...COMMON,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
    messages: [{ role: "user", content: prompt }],
  });
  const searches = msg.content.filter((b) => b.type === "server_tool_use").length;
  const raw = parseJsonLoose<unknown[]>(finalText(msg));
  const programs = (Array.isArray(raw) ? raw : [])
    .filter((p): p is DiscoveredProgram => {
      const o = p as DiscoveredProgram;
      return typeof o?.name === "string" && typeof o?.url === "string";
    })
    .map((p) => ({
      ...p,
      shortName: (p.shortName || p.name).slice(0, 24),
      type: PROGRAM_TYPES.includes(p.type) ? p.type : "state_program",
      awardType: AWARD_TYPES.includes(p.awardType) ? p.awardType : "soft_loan",
      sourceDocument: p.sourceDocument?.url ? p.sourceDocument : { title: p.name, url: p.url },
    }));
  return { programs, searches };
}

// ───────────────────────── Rule extraction ─────────────────────────

const OPS = ["gte", "lte", "gt", "lt", "eq", "neq", "in", "truthy", "falsy", "tiered", "amenity", "custom", "all", "any"] as const;
const AMENITY_TYPES: AmenityType[] = ["transit", "grocery", "school", "park", "pharmacy", "library", "medical"];
const COMPLIANCE_KINDS: ComplianceCheckKind[] = [
  "unit_income_at_movein", "unit_rent_limit", "annual_recert", "set_aside_minimum", "next_available_unit", "student_rule", "deadline", "manual",
];
const RULE_CATEGORIES = ["threshold", "scoring", "set_aside", "financial", "location", "readiness"];
const COMPLIANCE_CATEGORIES = ["income", "rent", "set_aside", "occupancy", "reporting", "physical", "affordability_term"];
const FREQUENCIES = ["once", "monthly", "annual", "triennial", "ongoing", "event"];

// Structured outputs need a closed schema, so the recursive DSL is flattened one level
// (all/any hold flat checks) and free-form params become key/value lists.
const scalar = { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }] };
const kvList = {
  type: "array",
  items: { type: "object", additionalProperties: false, required: ["key", "value"], properties: { key: { type: "string" }, value: { anyOf: [{ type: "string" }, { type: "number" }] } } },
};
const flatCheck = {
  type: "object",
  additionalProperties: false,
  required: ["op"],
  properties: {
    op: { type: "string", enum: OPS.filter((o) => o !== "all" && o !== "any") },
    field: { type: "string" },
    value: scalar,
    values: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } },
    direction: { type: "string", enum: ["higher_better", "lower_better"] },
    tiers: { type: "array", items: { type: "object", additionalProperties: false, required: ["threshold", "points"], properties: { threshold: { type: "number" }, points: { type: "number" } } } },
    amenityType: { type: "string", enum: AMENITY_TYPES },
    distanceTiers: { type: "array", items: { type: "object", additionalProperties: false, required: ["maxMiles", "points"], properties: { maxMiles: { type: "number" }, points: { type: "number" } } } },
    fn: { type: "string" },
    params: kvList,
  },
};
const checkSchema = {
  ...flatCheck,
  properties: { ...flatCheck.properties, op: { type: "string", enum: [...OPS] }, checks: { type: "array", items: flatCheck } },
};
export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["program", "rules", "complianceRules"],
  properties: {
    program: {
      type: "object",
      additionalProperties: false,
      required: ["name", "shortName", "administrator", "jurisdiction", "type", "awardType", "description", "typicalAward", "applicationCycle"],
      properties: {
        name: { type: "string" },
        shortName: { type: "string" },
        administrator: { type: "string" },
        jurisdiction: { type: "string" },
        type: { type: "string", enum: PROGRAM_TYPES },
        awardType: { type: "string", enum: AWARD_TYPES },
        description: { type: "string" },
        typicalAward: { type: "string" },
        applicationCycle: { type: "string" },
      },
    },
    rules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "category", "kind", "title", "description", "citation", "maxPoints", "check"],
        properties: {
          id: { type: "string" },
          category: { type: "string", enum: RULE_CATEGORIES },
          kind: { type: "string", enum: ["threshold", "points"] },
          title: { type: "string" },
          description: { type: "string" },
          citation: { type: "string" },
          maxPoints: { type: "number" },
          check: checkSchema,
        },
      },
    },
    complianceRules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "category", "title", "description", "citation", "frequency", "kind", "params"],
        properties: {
          id: { type: "string" },
          category: { type: "string", enum: COMPLIANCE_CATEGORIES },
          title: { type: "string" },
          description: { type: "string" },
          citation: { type: "string" },
          frequency: { type: "string", enum: FREQUENCIES },
          kind: { type: "string", enum: COMPLIANCE_KINDS },
          params: kvList,
        },
      },
    },
  },
};

export type KV = { key: string; value: string | number }[];
export interface FlatCheckOut {
  op: string;
  field?: string;
  value?: string | number | boolean;
  values?: (string | number)[];
  direction?: "higher_better" | "lower_better";
  tiers?: { threshold: number; points: number }[];
  amenityType?: AmenityType;
  distanceTiers?: { maxMiles: number; points: number }[];
  fn?: string;
  params?: KV;
  checks?: FlatCheckOut[];
}

const kvToRecord = (kv?: KV) => Object.fromEntries((kv ?? []).map((p) => [p.key, p.value]));
const FIELD_RE = /^(project|geo|derived)\.[A-Za-z0-9_.]+$/;

/** Converts the flattened model output into a RuleCheck, or null if it isn't evaluable. */
export function toRuleCheck(c: FlatCheckOut | undefined): RuleCheck | null {
  if (!c || !OPS.includes(c.op as (typeof OPS)[number])) return null;
  const field = c.field && FIELD_RE.test(c.field) ? c.field : null;
  switch (c.op) {
    case "gte": case "lte": case "gt": case "lt": case "eq": case "neq":
      return field && c.value !== undefined ? { op: c.op, field, value: c.value } : null;
    case "in":
      return field && c.values?.length ? { op: "in", field, value: c.values } : null;
    case "truthy": case "falsy":
      return field ? { op: c.op, field } : null;
    case "tiered":
      return field && c.tiers?.length ? { op: "tiered", field, direction: c.direction ?? "higher_better", tiers: c.tiers } : null;
    case "amenity":
      return c.amenityType && AMENITY_TYPES.includes(c.amenityType) && c.distanceTiers?.length
        ? { op: "amenity", amenityType: c.amenityType, tiers: c.distanceTiers }
        : null;
    case "custom":
      return c.fn && c.fn in CUSTOM_CHECKS ? { op: "custom", fn: c.fn, params: kvToRecord(c.params) } : null;
    case "all": case "any": {
      const checks = (c.checks ?? []).map(toRuleCheck);
      return checks.length && checks.every(Boolean) ? { op: c.op, checks: checks as RuleCheck[] } : null;
    }
  }
  return null;
}

export interface ExtractionResult {
  program: Omit<DiscoveredProgram, "url" | "sourceDocument">;
  rules: Rule[];
  complianceRules: ComplianceRule[];
  dropped: number;
}

export const EXTRACTION_SYSTEM = `You convert affordable-housing funding program documents (QAPs, NOFAs, program guidelines) into machine-checkable rules.

${describeDslForLLM()}

Output notes for this schema:
- For "in" put the allowed list in "values". For "amenity" put distance tiers in "distanceTiers". For "custom" put parameters in "params" as key/value pairs.
- "all"/"any" may contain only one level of nested checks.
- Thresholds (eligibility requirements) use kind "threshold" and maxPoints 0. Competitive scoring criteria use kind "points" with the document's maxPoints.
- Cite the section of the source document in "citation" (e.g. "2025 NOFA §4.2(b)").
- Only encode a rule if it can be expressed with the available fields; skip anything that cannot.
- Also list the post-award compliance obligations (income/rent limits, recertification, reporting, inspections, affordability term).`;

/** Raw extraction output as it comes back from the schema above. */
export interface RawExtraction {
  program: ExtractionResult["program"];
  rules: (Omit<Rule, "check" | "programId"> & { check: FlatCheckOut })[];
  complianceRules: { id: string; category: ComplianceRule["category"]; title: string; description: string; citation: string; frequency: ComplianceRule["frequency"]; kind: ComplianceCheckKind; params: KV }[];
}

export async function extractRules(
  programId: string,
  meta: { name: string; administrator?: string; url?: string },
  docText?: string,
): Promise<ExtractionResult & { usage: Anthropic.Beta.Messages.BetaUsage[] }> {
  const system = EXTRACTION_SYSTEM;

  const docPart = docText
    ? `Program: ${meta.name}${meta.administrator ? ` (${meta.administrator})` : ""}\n\n<document>\n${docText}\n</document>`
    : `Program: ${meta.name}${meta.administrator ? ` (${meta.administrator})` : ""}\nOfficial page: ${meta.url}\nUse web search to find this program's current guidelines / NOFA and extract its rules.`;

  const base = {
    ...COMMON,
    max_tokens: 32000,
    system,
    messages: [{ role: "user" as const, content: `${docPart}\n\nExtract the program metadata, eligibility thresholds, scoring criteria and compliance obligations.` }],
  };

  let parsed: RawExtraction;
  let usage: Anthropic.Beta.Messages.BetaUsage[];
  if (docText) {
    const msg = await runToCompletion({ ...base, output_config: { effort: "high", format: { type: "json_schema", schema: EXTRACTION_SCHEMA } } });
    parsed = JSON.parse(finalText(msg));
    usage = [msg.usage];
  } else {
    // Web search results carry citations, which can't be combined with output_config.format — parse text instead.
    const msg = await runToCompletion({
      ...base,
      output_config: { effort: "high" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      messages: [{ role: "user", content: `${base.messages[0].content}\n\nReply with ONLY a JSON object matching this JSON Schema:\n${JSON.stringify(EXTRACTION_SCHEMA)}` }],
    });
    parsed = parseJsonLoose(finalText(msg));
    usage = [msg.usage];
  }
  return { ...normalizeExtraction(parsed, programId, meta.name), usage };
}

/** Validates raw model output into evaluable rules; ids are prefixed with programId (may be ""). */
export function normalizeExtraction(parsed: RawExtraction, programId: string, fallbackCitation: string): ExtractionResult {
  const prefix = programId ? `${programId}.` : "";
  const meta = { name: fallbackCitation };
  let dropped = 0;
  const rules: Rule[] = [];
  for (const [i, r] of (parsed.rules ?? []).entries()) {
    const check = toRuleCheck(r.check);
    if (!check || !r.title || (r.kind !== "threshold" && r.kind !== "points")) {
      dropped++;
      continue;
    }
    rules.push({
      id: `${prefix}${r.id || `r${i}`}`.replace(/\s+/g, "_"),
      programId,
      category: RULE_CATEGORIES.includes(r.category) ? r.category : r.kind === "points" ? "scoring" : "threshold",
      kind: r.kind,
      title: r.title,
      description: r.description ?? "",
      citation: r.citation ?? meta.name,
      maxPoints: r.kind === "points" ? Math.max(0, Number(r.maxPoints) || 0) : undefined,
      check,
    });
  }
  const complianceRules: ComplianceRule[] = (parsed.complianceRules ?? [])
    .filter((c) => c.title && COMPLIANCE_KINDS.includes(c.kind))
    .map((c, i) => ({
      id: `${prefix}c.${c.id || i}`.replace(/\s+/g, "_"),
      programId,
      category: COMPLIANCE_CATEGORIES.includes(c.category) ? c.category : "reporting",
      title: c.title,
      description: c.description ?? "",
      citation: c.citation ?? meta.name,
      frequency: FREQUENCIES.includes(c.frequency) ? c.frequency : "ongoing",
      check: { kind: c.kind, params: kvToRecord(c.params) },
    }));
  return { program: parsed.program, rules, complianceRules, dropped };
}
