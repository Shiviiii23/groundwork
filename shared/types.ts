// Shared contract between server (agents, engine) and client (dashboards).
// Every module imports from here; change carefully.

// ───────────────────────── Client intake ─────────────────────────

export type ConstructionType = "new_construction" | "acq_rehab" | "adaptive_reuse";
export type TargetPopulation = "family" | "senior" | "supportive" | "special_needs";
export type GreenBuilding = "none" | "enterprise_green" | "leed" | "passive_house";
export type AmenityType = "transit" | "grocery" | "school" | "park" | "pharmacy" | "library" | "medical";

export interface UnitMixRow {
  bedrooms: number; // 0 = studio
  count: number;
  targetAmiPct: number; // 30 | 40 | 50 | 60 | 70 | 80 | 120 (120 = market/workforce)
  proposedRent: number; // monthly gross rent incl. utility allowance, USD
  sqft?: number;
}

export interface Amenity {
  type: AmenityType;
  name: string;
  distanceMiles: number;
  lat?: number;
  lng?: number;
}

export interface ProjectInput {
  name: string;
  address: string;
  city: string;
  state: string; // 2-letter USPS code, e.g. "CA"
  zip: string;
  lat?: number;
  lng?: number;
  constructionType: ConstructionType;
  targetPopulation: TargetPopulation;
  unitMix: UnitMixRow[];
  totalDevelopmentCost: number; // USD
  landCost: number; // USD (acquisition of land)
  committedLocalFunds: number; // USD already committed from local/soft sources
  developerExperienceProjects: number; // # of completed affordable projects
  nonprofitSponsor: boolean;
  siteControl: boolean;
  zoningApproved: boolean;
  localSupportLetter: boolean;
  serviceCoordination: boolean; // on-site resident services
  greenBuilding: GreenBuilding;
  affordabilityPeriodYears: number;
  amenitiesNearby?: Amenity[]; // client-supplied; geo agent fills/overrides
  notes?: string;
}

// ───────────────────────── Geo / public data ─────────────────────────

export interface DataSource {
  name: string; // e.g. "US Census Geocoder", "ACS 5-Year 2023"
  url?: string;
  live: boolean; // true = fetched live; false = bundled/estimated fallback
  retrievedAt: string; // ISO
}

export interface GeoContext {
  lat: number;
  lng: number;
  matchedAddress: string;
  stateFips: string; // "06"
  countyFips: string; // "001" (3-digit)
  tractCode: string; // "403000" (6-digit)
  geoid: string; // 11-digit tract GEOID
  countyName: string;
  tractName: string;
  population: number;
  tractMedianHouseholdIncome: number;
  areaMedianIncome: number; // 4-person AMI/median family income for the county/metro (HUD MFI proxy)
  povertyRate: number; // 0-1
  renterShare: number; // 0-1, renter-occupied / occupied units
  rentBurdenedShare: number; // 0-1, renter HH paying >=30% of income
  unemploymentRate: number; // 0-1
  isQCT: boolean; // HUD Qualified Census Tract
  qctBasis: "hud_list" | "estimated_from_acs";
  isDDA: boolean; // HUD Difficult Development Area
  isRural: boolean;
  opportunityArea: "highest" | "high" | "moderate" | "low" | "high_segregation_poverty";
  amenities: Amenity[];
  sources: DataSource[];
}

// ───────────────────────── Derived metrics ─────────────────────────

export interface DerivedMetrics {
  totalUnits: number;
  affordableUnits: number; // units at <= 80% AMI
  pctUnitsAt30: number; // 0-1 share of total units at <=30% AMI
  pctUnitsAt50: number; // <=50%
  pctUnitsAt60: number; // <=60%
  pctUnitsAt80: number; // <=80%
  averageAmiOfAffordable: number; // weighted avg targetAmiPct of LIHTC units (<=80)
  costPerUnit: number;
  landCostPerUnit: number;
  eligibleBasis: number; // (TDC - land) * 0.9 assumption, before boost
  basisBoostEligible: boolean; // QCT or DDA → 130%
  adjustedEligibleBasis: number;
  applicableFraction: number; // LIHTC unit share
  localLeverageRatio: number; // committedLocalFunds / TDC
  unitsOverRentLimit: number; // count of units whose proposedRent > LIHTC max rent for their AMI tier
  maxRentByTier: Record<string, Record<string, number>>; // amiPct -> bedrooms -> monthly gross limit
}

export interface EvaluationContext {
  project: ProjectInput;
  geo: GeoContext;
  derived: DerivedMetrics;
}

// ───────────────────────── Funding programs & rules ─────────────────────────

export type ProgramType =
  | "federal_tax_credit"
  | "federal_grant"
  | "federal_loan"
  | "state_program"
  | "local_program"
  | "private";

export type AwardType = "tax_credit" | "grant" | "soft_loan" | "loan_insurance" | "bond";

/**
 * Declarative rule check DSL. `field` is a dot path into EvaluationContext,
 * e.g. "derived.pctUnitsAt60", "geo.isQCT", "project.siteControl".
 * LLM-extracted rules must use these same shapes so the engine can score them.
 */
export type RuleCheck =
  | { op: "gte" | "lte" | "gt" | "lt" | "eq" | "neq"; field: string; value: number | string | boolean }
  | { op: "in"; field: string; value: (string | number)[] }
  | { op: "truthy" | "falsy"; field: string }
  | {
      op: "tiered"; // points by threshold of a numeric field
      field: string;
      direction: "higher_better" | "lower_better";
      tiers: { threshold: number; points: number }[];
    }
  | {
      op: "amenity"; // points by distance to nearest amenity of a type
      amenityType: AmenityType;
      tiers: { maxMiles: number; points: number }[];
    }
  | { op: "custom"; fn: string; params?: Record<string, unknown> } // named fn in engine registry
  | { op: "all" | "any"; checks: RuleCheck[] };

export type RuleCategory = "threshold" | "scoring" | "set_aside" | "financial" | "location" | "readiness";

export interface Rule {
  id: string;
  programId: string;
  category: RuleCategory;
  kind: "threshold" | "points"; // threshold = must pass for eligibility; points = competitive scoring
  title: string;
  description: string;
  citation: string; // e.g. "IRC §42(g)(1)", "CA TCAC Regs §10325(c)(5)(A)"
  maxPoints?: number; // for kind = "points"
  check: RuleCheck;
}

export type PursuitStatus = "considering" | "applying" | "awarded" | "declined";

export interface FundingProgram {
  id: string;
  name: string;
  shortName: string;
  type: ProgramType;
  awardType: AwardType;
  administrator: string; // e.g. "California Tax Credit Allocation Committee"
  jurisdiction: string; // "federal" | state code e.g. "CA" | locality name
  description: string;
  typicalAward: string; // human-readable e.g. "$1.5M–$2.5M annual credits"
  applicationCycle: string; // e.g. "Two rounds: March & July"
  url: string;
  sourceDocument: { title: string; url: string; year?: number };
  discoveredBy: "knowledge_base" | "web_search" | "uploaded_document";
  applicableStates?: string[]; // undefined = nationwide
  rules: Rule[];
  complianceRules: ComplianceRule[];
  pursuit?: PursuitStatus;
}

export type RuleStatus = "pass" | "fail" | "partial" | "needs_info";

export interface RuleResult {
  ruleId: string;
  title: string;
  kind: "threshold" | "points";
  category: RuleCategory;
  citation: string;
  status: RuleStatus;
  pointsEarned: number;
  maxPoints: number;
  actual: string; // what the client's data shows, human-readable
  expected: string; // what the rule requires, human-readable
  explanation: string;
  calculation?: string; // shows the math, e.g. "42 of 60 units ≤60% AMI = 70.0%"
  dataSources: string[]; // e.g. ["Client intake", "ACS 5-Year 2023 (B17001)"]
}

export interface ProgramScore {
  programId: string;
  eligible: boolean; // all thresholds pass (needs_info counts as not failed)
  thresholdsPassed: number;
  thresholdsTotal: number;
  pointsEarned: number;
  pointsPossible: number;
  scorePct: number; // pointsEarned / pointsPossible, 0-1 (1 if no points rules)
  fitScore: number; // 0-100 blended score used for ranking
  estimatedAward: number; // USD (for tax credits: 10-yr equity estimate)
  awardBasis: string; // explains the award estimate math
  results: RuleResult[];
  summary: string;
  recommendations: string[]; // concrete moves that would raise the score
}

// ───────────────────────── Agents & runs ─────────────────────────

export type AgentId = "intake" | "geo" | "discovery" | "extraction" | "scoring" | "compliance";
export type TaskStatus = "queued" | "running" | "done" | "error" | "skipped";

export interface AgentStep {
  ts: string; // ISO
  level: "info" | "tool" | "result" | "warn" | "error";
  message: string;
  detail?: string; // e.g. URL fetched, JSON snippet
}

export interface AgentTask {
  id: string;
  agent: AgentId;
  label: string; // e.g. "Geocoding & Census data"
  status: TaskStatus;
  progress: number; // 0-100
  startedAt?: string;
  finishedAt?: string;
  steps: AgentStep[];
  summary?: string; // one line result when done
}

export interface Run {
  id: string;
  projectId: string;
  status: "running" | "complete" | "error";
  startedAt: string;
  finishedAt?: string;
  llmEnabled: boolean; // whether Claude-powered search/extraction was used
  tasks: AgentTask[];
}

// ───────────────────────── Compliance ─────────────────────────

export type ComplianceCategory =
  | "income"
  | "rent"
  | "set_aside"
  | "occupancy"
  | "reporting"
  | "physical"
  | "affordability_term";

export type ComplianceCheckKind =
  | "unit_income_at_movein" // household income ≤ limit for designated AMI & household size
  | "unit_rent_limit" // rent + utility allowance ≤ max rent for designated AMI & bedrooms
  | "annual_recert" // income cert within last 12 months
  | "set_aside_minimum" // share of units at/below an AMI tier, params: { amiPct, minPct }
  | "next_available_unit" // 140% rule for over-income households
  | "student_rule" // full-time student households
  | "deadline" // recurring filing/inspection, params: { key, everyMonths }
  | "manual"; // tracked manually by checklist

export interface ComplianceRule {
  id: string;
  programId: string;
  category: ComplianceCategory;
  title: string;
  description: string;
  citation: string;
  frequency: "once" | "monthly" | "annual" | "triennial" | "ongoing" | "event";
  check: { kind: ComplianceCheckKind; params?: Record<string, number | string> };
}

export interface TenantUnit {
  unitId: string; // "101"
  bedrooms: number;
  designatedAmiPct: number; // the AMI tier this unit is restricted to
  isVacant: boolean;
  householdSize: number;
  annualIncomeAtMoveIn: number;
  currentAnnualIncome: number;
  rentCharged: number; // tenant-paid monthly rent
  utilityAllowance: number; // monthly
  moveInDate: string; // ISO date
  lastCertDate: string; // ISO date
  allFullTimeStudents: boolean;
}

export interface ComplianceEvent {
  key: string; // matches ComplianceRule.check.params.key, e.g. "annual_owner_cert"
  completedDate: string; // ISO date
  note?: string;
}

export interface ComplianceData {
  units: TenantUnit[];
  events: ComplianceEvent[];
  placedInServiceDate: string; // ISO date
  updatedAt: string;
}

export type ComplianceStatus = "compliant" | "at_risk" | "violation" | "pending";

export interface ComplianceFinding {
  ruleId: string;
  programId: string;
  title: string;
  category: ComplianceCategory;
  citation: string;
  status: ComplianceStatus;
  detail: string;
  affectedUnits: string[]; // unitIds
  dueDate?: string; // ISO for deadlines
  metric?: { label: string; value: number; threshold: number; unit: "%" | "$" | "count" | "days" };
}

export interface UnitComplianceRow {
  unitId: string;
  status: ComplianceStatus;
  incomeLimit: number;
  rentLimit: number;
  grossRent: number; // rentCharged + utilityAllowance
  incomePctOfLimit: number; // currentAnnualIncome / incomeLimit
  issues: string[];
}

export interface ComplianceReport {
  projectId: string;
  generatedAt: string;
  programIds: string[]; // programs with pursuit === "awarded" (or "applying" if none awarded)
  overall: ComplianceStatus;
  scorePct: number; // share of findings compliant, 0-1
  findings: ComplianceFinding[];
  units: UnitComplianceRow[];
  upcoming: { title: string; dueDate: string; programId: string; ruleId: string }[];
}

// ───────────────────────── Project aggregate ─────────────────────────

export interface Project {
  id: string;
  createdAt: string;
  updatedAt: string;
  input: ProjectInput;
  geo?: GeoContext;
  derived?: DerivedMetrics;
  programs: FundingProgram[];
  scores: ProgramScore[];
  latestRunId?: string;
  compliance?: ComplianceData;
}

export interface ProjectSummary {
  id: string;
  name: string;
  city: string;
  state: string;
  totalUnits: number;
  createdAt: string;
  runStatus?: Run["status"];
  topProgram?: { name: string; fitScore: number };
  eligibleCount: number;
  programCount: number;
  estimatedFundingTotal: number;
  complianceOverall?: ComplianceStatus;
}

export interface SampleProject {
  id: string;
  label: string;
  blurb: string;
  input: ProjectInput;
}

// Server-sent event payload on GET /api/projects/:id/stream
export interface StreamSnapshot {
  project: Project;
  run?: Run;
}

export interface HealthInfo {
  ok: true;
  llmEnabled: boolean;
  censusKey: boolean;
  model: string;
}
