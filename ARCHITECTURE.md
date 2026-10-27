# Groundwork — architecture & build contract

Prototype app for affordable-housing developers: intake a site → discover funding
sources (9% / 4% LIHTC, HOME, HTF, AHP, state programs…) → extract each program's
rules → score the client's project against them using public data (Census geocoder,
ACS, HUD QCT/DDA) → dashboards for funding fit and post-award compliance.

Stack: one npm package. Vite + React 18 + Tailwind + Recharts + react-leaflet (client, `src/`),
Express + tsx (server, `server/`), shared types in `shared/types.ts` (import as
`../shared/types` from server, `@shared/types` from client). Node 22, ESM, TypeScript strict.
Claude via `@anthropic-ai/sdk` (model `claude-opus-5-5`) is OPTIONAL — enabled when
`ANTHROPIC_API_KEY` (or other SDK credentials) is present. Everything must work offline
with bundled data and clearly label data as live vs. fallback (`DataSource.live`).

## Directory ownership

| Path | Owner | Contents |
|---|---|---|
| `shared/types.ts` | lead | the contract — do not change without telling the lead |
| `server/data/programs.ts` | engine | funding program knowledge base (rules + compliance rules, real citations) |
| `server/data/samples.ts` | engine | `SAMPLE_PROJECTS: SampleProject[]` (3 realistic demo projects: Oakland CA, Austin TX, Bronx NY) |
| `server/engine/*` | engine | pure functions: derive metrics, income/rent limits, rule evaluation, award estimate, compliance, sample rent roll, `selftest.ts` |
| `server/index.ts`, `server/store.ts`, `server/orchestrator.ts`, `server/llm.ts` | backend | Express API, JSON file store in `server/.data/`, agent orchestration + SSE |
| `server/agents/*` | backend | intake, geo, discovery, extraction, scoring, compliance agents |
| `server/geo/*` | backend | Census geocoder, ACS, HUD QCT, Overpass amenity lookups + offline fallback dataset |
| `src/**` | frontend | dashboards |

## Engine module API (implemented by engine, consumed by backend)

```ts
// server/data/programs.ts
export const PROGRAM_CATALOG: FundingProgram[];
export function catalogForProject(input: ProjectInput): FundingProgram[]; // filter by state & applicability, deep-cloned

// server/data/samples.ts
export const SAMPLE_PROJECTS: SampleProject[];

// server/engine/limits.ts
export function incomeLimit(ami4: number, amiPct: number, householdSize: number): number;   // annual, HUD size adjustments
export function rentLimit(ami4: number, amiPct: number, bedrooms: number): number;          // monthly gross, LIHTC 1.5 persons/BR imputation

// server/engine/derive.ts
export function deriveMetrics(input: ProjectInput, geo: GeoContext): DerivedMetrics;

// server/engine/evaluate.ts
export function evaluateRule(rule: Rule, ctx: EvaluationContext): RuleResult;
export function evaluateProgram(program: FundingProgram, ctx: EvaluationContext): ProgramScore;
export const CUSTOM_CHECKS: Record<string, (ctx: EvaluationContext, params?: Record<string, unknown>) => Omit<RuleResult, "ruleId"|"title"|"kind"|"category"|"citation"|"maxPoints">>;
export function describeDslForLLM(): string; // text describing the RuleCheck DSL + available fields + custom fn names, used in the extraction prompt

// server/engine/compliance.ts
export function evaluateCompliance(project: Project): ComplianceReport;
export function sampleComplianceData(project: Project): ComplianceData; // realistic rent roll with a few deliberate issues
export function parseRentRollCsv(csv: string): TenantUnit[];
```

## HTTP API (implemented by backend, consumed by frontend; all JSON, prefix `/api`, port 8787; Vite proxies `/api`)

| Method & path | Body | Returns |
|---|---|---|
| `GET /api/health` | – | `HealthInfo` |
| `GET /api/samples` | – | `SampleProject[]` |
| `GET /api/projects` | – | `ProjectSummary[]` |
| `POST /api/projects` | `ProjectInput` | `{ project: Project, run: Run }` — run starts immediately |
| `GET /api/projects/:id` | – | `{ project: Project, run?: Run }` |
| `DELETE /api/projects/:id` | – | `{ ok: true }` |
| `POST /api/projects/:id/rerun` | – | `{ run: Run }` |
| `GET /api/projects/:id/stream` | – | SSE; `event: snapshot` with `data: StreamSnapshot` on every change (≥ every 1.5s while running); closes ~2s after run completes |
| `POST /api/projects/:id/documents` | `{ title: string; url?: string; text: string }` | `{ run: Run }` — runs extraction + scoring on a pasted funding document (QAP/NOFA), adds a program with `discoveredBy: "uploaded_document"` |
| `PATCH /api/projects/:id/programs/:programId` | `{ pursuit: PursuitStatus }` | `{ project: Project }` |
| `GET /api/projects/:id/compliance` | – | `{ report: ComplianceReport, data: ComplianceData }` (auto-creates sample data if none) |
| `PUT /api/projects/:id/compliance/units` | `{ units?: TenantUnit[]; csv?: string }` | `{ report, data }` |
| `POST /api/projects/:id/compliance/sample` | – | `{ report, data }` regenerate sample rent roll |
| `POST /api/projects/:id/compliance/events` | `ComplianceEvent` | `{ report, data }` |

## Agent pipeline (one `Run`, tasks in this order; geo & discovery run in parallel)

1. **intake** — validate & normalize input (state code, unit mix totals, sanity warnings).
2. **geo** — Census geocoder (address → lat/lng, tract GEOID) → ACS 5-yr tract + county
   (B19013 median HH income, B19113 county median family income as AMI proxy, B17001 poverty,
   B25003 tenure, B25070 rent burden, B23025 unemployment, B01003 pop) → HUD QCT/DDA
   (HUD ArcGIS layer; else estimate QCT from ACS: poverty ≥25% or tract income <60% of AMI) →
   OSM Overpass amenities within 1.5 mi. Each fetch is a `tool` step with URL. Any failure →
   fallback dataset (`live: false`) with a `warn` step.
3. **discovery** — knowledge base via `catalogForProject`; if LLM enabled, Claude with
   `web_search` finds additional state/local programs for the city/state and returns
   structured candidates (name, administrator, url, summary, source doc).
4. **extraction** — knowledge-base programs already carry encoded rules (log "loaded N rules
   from <sourceDocument>"); for web-found / uploaded programs Claude extracts rules into the
   RuleCheck DSL (structured output; use `describeDslForLLM()`); invalid rules are dropped.
5. **scoring** — `deriveMetrics` + `evaluateProgram` per program; steps narrate calculations
   (e.g. "QCT → 130% basis boost: $41.2M adjusted eligible basis").
6. **compliance** — build compliance rule index for programs; summary of obligations.

Steps should stream with small realistic delays (150–600ms) so the "in flight" view is
legible even when everything is local.
