// Rule evaluation engine: scores a client's project against a funding program's
// declarative rules (the RuleCheck DSL in shared/types.ts). Each result explains
// what the client data shows, what the rule requires, and the math in between.

import type {
  Amenity,
  AmenityType,
  EvaluationContext,
  FundingProgram,
  ProgramScore,
  Rule,
  RuleCheck,
  RuleResult,
  RuleStatus,
} from "../../shared/types";
import { estimateAward, underwrite } from "./award";
import { miles, num, pct, usd, usdExact, yesNo } from "./format";
import { rentLimit } from "./limits";

type CheckOutcome = Omit<RuleResult, "ruleId" | "title" | "kind" | "category" | "citation" | "maxPoints">;
type CustomCheck = (ctx: EvaluationContext, params?: Record<string, unknown>) => CheckOutcome;

const INTAKE = "Client intake";
const DERIVED = "Groundwork calculation";

// ───────────────────────── Field registry ─────────────────────────

type FieldFormat = "pct" | "usd" | "bool" | "num" | "years" | "ami" | "text" | "ratio";

interface FieldInfo {
  label: string;
  format: FieldFormat;
  source: "intake" | "geo" | "derived";
}

/** Every field path the DSL may reference. Also drives describeDslForLLM(). */
export const FIELD_INFO: Record<string, FieldInfo> = {
  "project.state": { label: "State", format: "text", source: "intake" },
  "project.city": { label: "City", format: "text", source: "intake" },
  "project.constructionType": { label: "Construction type", format: "text", source: "intake" },
  "project.targetPopulation": { label: "Target population", format: "text", source: "intake" },
  "project.totalDevelopmentCost": { label: "Total development cost", format: "usd", source: "intake" },
  "project.landCost": { label: "Land cost", format: "usd", source: "intake" },
  "project.committedLocalFunds": { label: "Committed local funds", format: "usd", source: "intake" },
  "project.developerExperienceProjects": { label: "Completed affordable projects", format: "num", source: "intake" },
  "project.nonprofitSponsor": { label: "Nonprofit sponsor", format: "bool", source: "intake" },
  "project.siteControl": { label: "Site control", format: "bool", source: "intake" },
  "project.zoningApproved": { label: "Zoning / entitlements approved", format: "bool", source: "intake" },
  "project.localSupportLetter": { label: "Local government support letter", format: "bool", source: "intake" },
  "project.serviceCoordination": { label: "On-site resident services", format: "bool", source: "intake" },
  "project.greenBuilding": { label: "Green building standard", format: "text", source: "intake" },
  "project.affordabilityPeriodYears": { label: "Affordability period", format: "years", source: "intake" },
  "geo.isQCT": { label: "Qualified Census Tract", format: "bool", source: "geo" },
  "geo.isDDA": { label: "Difficult Development Area", format: "bool", source: "geo" },
  "geo.isRural": { label: "Rural area", format: "bool", source: "geo" },
  "geo.opportunityArea": { label: "Opportunity area designation", format: "text", source: "geo" },
  "geo.povertyRate": { label: "Tract poverty rate", format: "pct", source: "geo" },
  "geo.renterShare": { label: "Tract renter share", format: "pct", source: "geo" },
  "geo.rentBurdenedShare": { label: "Rent-burdened renter households", format: "pct", source: "geo" },
  "geo.unemploymentRate": { label: "Tract unemployment rate", format: "pct", source: "geo" },
  "geo.tractMedianHouseholdIncome": { label: "Tract median household income", format: "usd", source: "geo" },
  "geo.areaMedianIncome": { label: "Area median income (4-person)", format: "usd", source: "geo" },
  "geo.population": { label: "Tract population", format: "num", source: "geo" },
  "derived.totalUnits": { label: "Total units", format: "num", source: "derived" },
  "derived.affordableUnits": { label: "Units ≤ 80% AMI", format: "num", source: "derived" },
  "derived.pctUnitsAt30": { label: "Share of units ≤ 30% AMI", format: "pct", source: "derived" },
  "derived.pctUnitsAt50": { label: "Share of units ≤ 50% AMI", format: "pct", source: "derived" },
  "derived.pctUnitsAt60": { label: "Share of units ≤ 60% AMI", format: "pct", source: "derived" },
  "derived.pctUnitsAt80": { label: "Share of units ≤ 80% AMI", format: "pct", source: "derived" },
  "derived.averageAmiOfAffordable": { label: "Average AMI of restricted units", format: "ami", source: "derived" },
  "derived.costPerUnit": { label: "Total development cost per unit", format: "usd", source: "derived" },
  "derived.landCostPerUnit": { label: "Land cost per unit", format: "usd", source: "derived" },
  "derived.eligibleBasis": { label: "Eligible basis", format: "usd", source: "derived" },
  "derived.basisBoostEligible": { label: "Eligible for 130% basis boost", format: "bool", source: "derived" },
  "derived.adjustedEligibleBasis": { label: "Adjusted eligible basis", format: "usd", source: "derived" },
  "derived.applicableFraction": { label: "Applicable fraction", format: "pct", source: "derived" },
  "derived.localLeverageRatio": { label: "Local funds as share of TDC", format: "pct", source: "derived" },
  "derived.unitsOverRentLimit": { label: "Units over LIHTC rent limit", format: "num", source: "derived" },
};

function getField(ctx: EvaluationContext, path: string): unknown {
  return path.split(".").reduce<unknown>((obj, key) => (obj == null ? undefined : (obj as Record<string, unknown>)[key]), ctx);
}

function fieldLabel(path: string): string {
  return FIELD_INFO[path]?.label ?? path.split(".").pop()!;
}

function fmt(path: string, value: unknown): string {
  if (value === undefined || value === null) return "not provided";
  const info = FIELD_INFO[path];
  switch (info?.format) {
    case "pct":
      return pct(Number(value));
    case "usd":
      return usd(Number(value));
    case "bool":
      return yesNo(value);
    case "years":
      return `${value} years`;
    case "ami":
      return `${Number(value).toFixed(1)}% AMI`;
    case "num":
      return num(Number(value));
    default:
      return typeof value === "boolean" ? yesNo(value) : String(value).replace(/_/g, " ");
  }
}

function sourcesFor(path: string, ctx: EvaluationContext): string[] {
  const src = FIELD_INFO[path]?.source ?? "intake";
  if (src === "intake") return [INTAKE];
  if (src === "derived") return [INTAKE, DERIVED];
  return geoSources(ctx);
}

function geoSources(ctx: EvaluationContext): string[] {
  const s = ctx.geo.sources.map((d) => `${d.name}${d.live ? "" : " (offline estimate)"}`);
  return s.length ? s : ["Geo context"];
}

const OP_TEXT: Record<string, string> = { gte: "≥", lte: "≤", gt: ">", lt: "<", eq: "=", neq: "≠" };

// ───────────────────────── Amenities ─────────────────────────

function amenitiesFor(ctx: EvaluationContext): Amenity[] {
  return ctx.geo.amenities?.length ? ctx.geo.amenities : ctx.project.amenitiesNearby ?? [];
}

function nearest(ctx: EvaluationContext, type: AmenityType): Amenity | undefined {
  return amenitiesFor(ctx)
    .filter((a) => a.type === type)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)[0];
}

function amenitySources(ctx: EvaluationContext): string[] {
  const geoAmen = ctx.geo.sources.filter((s) => /overpass|osm|amenit/i.test(s.name));
  if (ctx.geo.amenities?.length && geoAmen.length) return geoAmen.map((d) => `${d.name}${d.live ? "" : " (offline estimate)"}`);
  return ctx.geo.amenities?.length ? geoSources(ctx) : [INTAKE];
}

// ───────────────────────── Core check evaluation ─────────────────────────

function compare(op: string, a: unknown, b: unknown): boolean {
  switch (op) {
    case "gte":
      return Number(a) >= Number(b);
    case "lte":
      return Number(a) <= Number(b);
    case "gt":
      return Number(a) > Number(b);
    case "lt":
      return Number(a) < Number(b);
    case "eq":
      return a === b;
    case "neq":
      return a !== b;
  }
  return false;
}

function statusFromPoints(earned: number, max: number): RuleStatus {
  if (max <= 0) return earned > 0 ? "pass" : "fail";
  if (earned >= max) return "pass";
  return earned > 0 ? "partial" : "fail";
}

function runCheck(check: RuleCheck, ctx: EvaluationContext, maxPoints: number): CheckOutcome {
  switch (check.op) {
    case "gte":
    case "lte":
    case "gt":
    case "lt":
    case "eq":
    case "neq": {
      const v = getField(ctx, check.field);
      if (v === undefined || v === null) return needsInfo(check.field, ctx);
      const ok = compare(check.op, v, check.value);
      return {
        status: ok ? "pass" : "fail",
        pointsEarned: ok ? maxPoints : 0,
        actual: `${fieldLabel(check.field)}: ${fmt(check.field, v)}`,
        expected: `${fieldLabel(check.field)} ${OP_TEXT[check.op]} ${fmt(check.field, check.value)}`,
        explanation: ok ? "Requirement met." : "Requirement not met.",
        calculation: `${fmt(check.field, v)} ${OP_TEXT[check.op]} ${fmt(check.field, check.value)} → ${ok ? "true" : "false"}`,
        dataSources: sourcesFor(check.field, ctx),
      };
    }
    case "in": {
      const v = getField(ctx, check.field);
      if (v === undefined || v === null) return needsInfo(check.field, ctx);
      const ok = check.value.includes(v as string | number);
      return {
        status: ok ? "pass" : "fail",
        pointsEarned: ok ? maxPoints : 0,
        actual: `${fieldLabel(check.field)}: ${fmt(check.field, v)}`,
        expected: `One of: ${check.value.map((x) => fmt(check.field, x)).join(", ")}`,
        explanation: ok ? "Matches an eligible category." : "Not an eligible category for this rule.",
        dataSources: sourcesFor(check.field, ctx),
      };
    }
    case "truthy":
    case "falsy": {
      const v = getField(ctx, check.field);
      if (v === undefined || v === null) return needsInfo(check.field, ctx);
      const ok = check.op === "truthy" ? Boolean(v) : !v;
      return {
        status: ok ? "pass" : "fail",
        pointsEarned: ok ? maxPoints : 0,
        actual: `${fieldLabel(check.field)}: ${fmt(check.field, v)}`,
        expected: `${fieldLabel(check.field)}: ${check.op === "truthy" ? "Yes" : "No"}`,
        explanation: ok ? "Requirement met." : "Requirement not met.",
        dataSources: sourcesFor(check.field, ctx),
      };
    }
    case "tiered": {
      const raw = getField(ctx, check.field);
      if (raw === undefined || raw === null) return needsInfo(check.field, ctx);
      const v = Number(raw);
      const tiers = [...check.tiers].sort((a, b) => b.points - a.points);
      const hit = tiers.find((t) => (check.direction === "higher_better" ? v >= t.threshold : v <= t.threshold));
      const earned = Math.min(hit?.points ?? 0, maxPoints || Infinity);
      const sym = check.direction === "higher_better" ? "≥" : "≤";
      const top = tiers[0];
      return {
        status: statusFromPoints(earned, maxPoints || top.points),
        pointsEarned: earned,
        actual: `${fieldLabel(check.field)}: ${fmt(check.field, v)}`,
        expected: tiers.map((t) => `${sym} ${fmt(check.field, t.threshold)} → ${t.points} pts`).join("; "),
        explanation: hit
          ? `Qualifies for the ${sym} ${fmt(check.field, hit.threshold)} tier.`
          : `Below the lowest scoring tier (${sym} ${fmt(check.field, tiers[tiers.length - 1].threshold)}).`,
        calculation: `${fmt(check.field, v)} → ${earned} of ${maxPoints || top.points} pts`,
        dataSources: sourcesFor(check.field, ctx),
      };
    }
    case "amenity": {
      const tiers = [...check.tiers].sort((a, b) => a.maxMiles - b.maxMiles);
      const a = nearest(ctx, check.amenityType);
      const label = check.amenityType.replace(/_/g, " ");
      const expected = tiers.map((t) => `≤ ${t.maxMiles} mi → ${t.points} pts`).join("; ");
      if (!a) {
        return {
          status: amenitiesFor(ctx).length ? "fail" : "needs_info",
          pointsEarned: 0,
          actual: amenitiesFor(ctx).length ? `No ${label} found within search radius` : "No amenity data available",
          expected,
          explanation: amenitiesFor(ctx).length
            ? `No ${label} was found near the site.`
            : "Provide nearby amenities or enable the amenity lookup.",
          dataSources: amenitySources(ctx),
        };
      }
      const hit = tiers.find((t) => a.distanceMiles <= t.maxMiles);
      const earned = Math.min(hit?.points ?? 0, maxPoints || Infinity);
      const top = Math.max(...tiers.map((t) => t.points));
      return {
        status: statusFromPoints(earned, maxPoints || top),
        pointsEarned: earned,
        actual: `Nearest ${label}: ${a.name} at ${miles(a.distanceMiles)}`,
        expected,
        explanation: hit ? `Within the ${hit.maxMiles}-mile tier.` : `Farther than ${tiers[tiers.length - 1].maxMiles} mi.`,
        calculation: `${miles(a.distanceMiles)} → ${earned} of ${maxPoints || top} pts`,
        dataSources: amenitySources(ctx),
      };
    }
    case "custom": {
      const fn = CUSTOM_CHECKS[check.fn];
      if (!fn) {
        return {
          status: "needs_info",
          pointsEarned: 0,
          actual: "—",
          expected: check.fn,
          explanation: `Unknown check "${check.fn}" — requires manual review.`,
          dataSources: [],
        };
      }
      return fn(ctx, { ...(check.params ?? {}), maxPoints });
    }
    case "all":
    case "any": {
      const subs = check.checks.map((c) => runCheck(c, ctx, 0));
      const passes = subs.filter((s) => s.status === "pass").length;
      const ok = check.op === "all" ? passes === subs.length : passes > 0;
      const anyInfo = subs.some((s) => s.status === "needs_info");
      const status: RuleStatus = ok ? "pass" : anyInfo ? "needs_info" : check.op === "all" && passes > 0 ? "partial" : "fail";
      const earned = ok ? maxPoints : status === "partial" && maxPoints ? Math.floor((maxPoints * passes) / subs.length) : 0;
      return {
        status,
        pointsEarned: earned,
        actual: subs.map((s) => s.actual).join(" · "),
        expected: `${check.op === "all" ? "All" : "Any"} of: ${subs.map((s) => s.expected).join(" · ")}`,
        explanation: `${passes} of ${subs.length} conditions met.`,
        dataSources: Array.from(new Set(subs.flatMap((s) => s.dataSources))),
      };
    }
  }
}

function needsInfo(path: string, ctx: EvaluationContext): CheckOutcome {
  return {
    status: "needs_info",
    pointsEarned: 0,
    actual: `${fieldLabel(path)}: not provided`,
    expected: `${fieldLabel(path)} must be provided`,
    explanation: "Missing data — add it to the project intake to evaluate this rule.",
    dataSources: sourcesFor(path, ctx),
  };
}

// ───────────────────────── Custom checks ─────────────────────────

const pointsParam = (p?: Record<string, unknown>) => Number(p?.maxPoints ?? 0);

const CUSTOM_DOCS: Record<string, string> = {
  lihtc_minimum_set_aside:
    "IRC §42(g)(1) minimum set-aside: passes on 20/50, 40/60, or income averaging (≥40% of units ≤80% AMI averaging ≤60%).",
  rents_within_limits: "Every restricted unit's proposed gross rent ≤ the LIHTC max rent for its AMI tier & bedroom count.",
  cost_per_unit_cap: "TDC per unit ≤ params.maxPerUnit (params.boostPct raises the cap in QCT/DDA, e.g. 0.1 = +10%).",
  basis_boost: "Site is in a HUD QCT or DDA (eligible for 130% basis boost). Points if so.",
  opportunity_area:
    "Points by geo.opportunityArea; params map designation → points, e.g. {highest: 8, high: 8, moderate: 4}.",
  readiness: "Site control + zoning/entitlements. Full points with both, half with one.",
  green_building: "Points by green standard; params {passive_house, leed, enterprise_green} → points.",
  amenity_count:
    "Points per distinct amenity type within params.maxMiles (params.pointsPerType), capped at maxPoints.",
  tcac_site_amenities:
    "California TCAC site-amenity table (transit, park, library, grocery, school, medical, pharmacy), capped at params.cap (default 15).",
  bond_financing_test:
    "4% LIHTC: tax-exempt bonds must finance ≥ params.threshold (default 0.25 post-2025; 0.50 before) of aggregate basis + land. Reports the required bond amount (needs confirmation).",
  dscr_feasibility:
    "Underwrites NOI from proposed rents; passes if supportable debt ≥ params.minLoanToCost of TDC (default 0.15); points tiered by loan-to-cost.",
  cdbg_eligible_activity:
    "CDBG cannot fund new residential construction by a unit of government (24 CFR 570.207(b)(3)); acq/rehab passes, new construction needs a CBDO or site/infrastructure structuring.",
  requires_documentation: "Item that cannot be computed from data (params.item); always returns needs_info with guidance.",
  supportive_population: "Target population is supportive or special needs.",
};

export const CUSTOM_CHECKS: Record<string, CustomCheck> = {
  lihtc_minimum_set_aside(ctx) {
    const d = ctx.derived;
    const t2050 = d.pctUnitsAt50 >= 0.2;
    const t4060 = d.pctUnitsAt60 >= 0.4;
    const avg = d.pctUnitsAt80 >= 0.4 && d.averageAmiOfAffordable <= 60;
    const met = [t2050 && "20/50", t4060 && "40/60", avg && "income averaging"].filter(Boolean) as string[];
    return {
      status: met.length ? "pass" : "fail",
      pointsEarned: 0,
      actual: `${pct(d.pctUnitsAt50)} of units ≤ 50% AMI; ${pct(d.pctUnitsAt60)} ≤ 60% AMI; restricted-unit average ${d.averageAmiOfAffordable.toFixed(1)}% AMI`,
      expected: "20% of units ≤ 50% AMI, OR 40% ≤ 60% AMI, OR 40% ≤ 80% AMI averaging ≤ 60% AMI",
      explanation: met.length ? `Satisfies the ${met.join(" and ")} test.` : "No minimum set-aside election can be satisfied by the current unit mix.",
      calculation: `20/50: ${pct(d.pctUnitsAt50)} ≥ 20% → ${t2050}; 40/60: ${pct(d.pctUnitsAt60)} ≥ 40% → ${t4060}; avg: ${d.averageAmiOfAffordable.toFixed(1)}% ≤ 60% → ${avg}`,
      dataSources: [INTAKE, DERIVED],
    };
  },

  rents_within_limits(ctx, p) {
    const ami = ctx.geo.areaMedianIncome;
    const rows = ctx.project.unitMix.filter((r) => r.targetAmiPct <= 80 && r.count > 0);
    const over = rows
      .map((r) => ({ r, limit: rentLimit(ami, r.targetAmiPct, r.bedrooms) }))
      .filter(({ r, limit }) => r.proposedRent > limit);
    const overUnits = over.reduce((s, o) => s + o.r.count, 0);
    const br = (b: number) => (b === 0 ? "Studio" : `${b}BR`);
    return {
      status: over.length ? "fail" : "pass",
      pointsEarned: over.length ? 0 : pointsParam(p),
      actual: over.length
        ? `${overUnits} units over limit: ${over
            .map(({ r, limit }) => `${br(r.bedrooms)} @ ${r.targetAmiPct}% AMI ${usdExact(r.proposedRent)} vs ${usdExact(limit)}`)
            .join("; ")}`
        : `All ${rows.reduce((s, r) => s + r.count, 0)} restricted units at or below limit`,
      expected: "Gross rent ≤ 30% of imputed income limit (1.5 persons/bedroom)",
      explanation: over.length
        ? "Reduce proposed rents (or re-tier those units) to the published max rent."
        : "Proposed rents fit within published LIHTC rent limits.",
      calculation: `AMI ${usdExact(ami)} → e.g. 2BR @ 60% max gross rent ${usdExact(rentLimit(ami, 60, 2))}/mo`,
      dataSources: [INTAKE, ...geoSources(ctx).slice(0, 2), DERIVED],
    };
  },

  cost_per_unit_cap(ctx, p) {
    const base = Number(p?.maxPerUnit ?? 500_000);
    const boost = ctx.derived.basisBoostEligible ? Number(p?.boostPct ?? 0) : 0;
    const cap = base * (1 + boost);
    const v = ctx.derived.costPerUnit;
    const ok = v <= cap;
    return {
      status: ok ? "pass" : "fail",
      pointsEarned: ok ? pointsParam(p) : 0,
      actual: `TDC per unit ${usd(v)} (${usd(ctx.project.totalDevelopmentCost)} ÷ ${ctx.derived.totalUnits} units)`,
      expected: `≤ ${usd(cap)} per unit${boost ? ` (incl. +${pct(boost, 0)} QCT/DDA allowance)` : ""}`,
      explanation: ok ? "Within the per-unit cost limit." : `Over the cap by ${usd(v - cap)} per unit — value-engineer or add units.`,
      calculation: `${usd(v)} ${ok ? "≤" : ">"} ${usd(cap)}`,
      dataSources: [INTAKE, DERIVED],
    };
  },

  basis_boost(ctx, p) {
    const g = ctx.geo;
    const ok = g.isQCT || g.isDDA;
    const d = ctx.derived;
    return {
      status: ok ? "pass" : "fail",
      pointsEarned: ok ? pointsParam(p) : 0,
      actual: `QCT: ${yesNo(g.isQCT)}${g.isQCT && g.qctBasis === "estimated_from_acs" ? " (estimated from ACS)" : ""}; DDA: ${yesNo(g.isDDA)} — tract ${g.geoid}`,
      expected: "Located in a HUD Qualified Census Tract or Difficult Development Area",
      explanation: ok
        ? "Eligible for the 130% basis boost under IRC §42(d)(5)(B)."
        : "Not in a QCT/DDA — no automatic basis boost (some states allow a discretionary boost).",
      calculation: `Eligible basis ${usd(d.eligibleBasis)} × ${ok ? "130%" : "100%"} = ${usd(d.adjustedEligibleBasis)}`,
      dataSources: geoSources(ctx),
    };
  },

  opportunity_area(ctx, p) {
    const area = ctx.geo.opportunityArea;
    const earned = Math.min(Number((p as Record<string, unknown> | undefined)?.[area] ?? 0), pointsParam(p) || Infinity);
    const table = ["highest", "high", "moderate", "low"]
      .filter((k) => p?.[k] !== undefined)
      .map((k) => `${k} → ${p?.[k]} pts`)
      .join("; ");
    return {
      status: statusFromPoints(earned, pointsParam(p)),
      pointsEarned: earned,
      actual: `Opportunity area: ${area.replace(/_/g, " ")}`,
      expected: table || "Higher-opportunity designation",
      explanation:
        earned > 0 ? "Site's opportunity designation earns points." : "Site is not in a scoring opportunity designation.",
      calculation: `Tract poverty ${pct(ctx.geo.povertyRate)}, median HH income ${usd(ctx.geo.tractMedianHouseholdIncome)} (${pct(
        ctx.geo.tractMedianHouseholdIncome / ctx.geo.areaMedianIncome,
        0,
      )} of AMI) → ${area.replace(/_/g, " ")}`,
      dataSources: geoSources(ctx),
    };
  },

  readiness(ctx, p) {
    const sc = ctx.project.siteControl;
    const z = ctx.project.zoningApproved;
    const max = pointsParam(p);
    const earned = sc && z ? max : sc || z ? Math.floor(max / 2) : 0;
    return {
      status: sc && z ? "pass" : sc || z ? "partial" : "fail",
      pointsEarned: earned,
      actual: `Site control: ${yesNo(sc)}; zoning/entitlements: ${yesNo(z)}`,
      expected: "Site control AND all discretionary land-use approvals in place",
      explanation: sc && z ? "Project is shovel-ready on land use." : "Secure missing site control / entitlements before application.",
      dataSources: [INTAKE],
    };
  },

  green_building(ctx, p) {
    const std = ctx.project.greenBuilding;
    const earned = Math.min(Number(p?.[std] ?? 0), pointsParam(p) || Infinity);
    return {
      status: statusFromPoints(earned, pointsParam(p)),
      pointsEarned: earned,
      actual: `Green standard: ${std.replace(/_/g, " ")}`,
      expected: ["passive_house", "leed", "enterprise_green"]
        .filter((k) => p?.[k] !== undefined)
        .map((k) => `${k.replace(/_/g, " ")} → ${p?.[k]} pts`)
        .join("; "),
      explanation: earned ? "Green certification earns points." : "Commit to a recognized green standard to earn points.",
      dataSources: [INTAKE],
    };
  },

  amenity_count(ctx, p) {
    const max = Number(p?.maxMiles ?? 0.5);
    const per = Number(p?.pointsPerType ?? 1);
    const types = Array.from(new Set(amenitiesFor(ctx).filter((a) => a.distanceMiles <= max).map((a) => a.type)));
    const earned = Math.min(types.length * per, pointsParam(p) || Infinity);
    return {
      status: statusFromPoints(earned, pointsParam(p)),
      pointsEarned: earned,
      actual: types.length ? `${types.length} amenity types within ${max} mi: ${types.join(", ")}` : `None within ${max} mi`,
      expected: `${per} pt per amenity type within ${max} mi (max ${pointsParam(p)})`,
      explanation: `${types.length} distinct amenity types nearby.`,
      calculation: `${types.length} × ${per} = ${types.length * per} → ${earned} pts`,
      dataSources: amenitySources(ctx),
    };
  },

  tcac_site_amenities(ctx, p) {
    // Simplified from 4 CCR §10325(c)(5)(A); distances in miles (rural sites get extended distances).
    const rural = ctx.geo.isRural;
    const r = (m: number) => (rural ? m * 1.5 : m);
    const table: { type: AmenityType; tiers: [number, number][] }[] = [
      { type: "transit", tiers: [[r(1 / 3), 7], [r(0.5), 6], [r(1), 3]] },
      { type: "park", tiers: [[r(0.5), 3], [r(0.75), 2]] },
      { type: "library", tiers: [[r(0.5), 3], [r(1), 2]] },
      { type: "grocery", tiers: [[r(0.5), 5], [r(1), 4], [r(1.5), 3]] },
      { type: "school", tiers: [[r(0.75), 3], [r(1), 2]] },
      { type: "medical", tiers: [[r(0.5), 3], [r(1), 2]] },
      { type: "pharmacy", tiers: [[r(0.5), 2], [r(1), 1]] },
    ];
    const cap = Number(p?.cap ?? 15);
    const parts: string[] = [];
    let total = 0;
    for (const row of table) {
      const a = nearest(ctx, row.type);
      const hit = a ? row.tiers.find(([mi]) => a.distanceMiles <= mi) : undefined;
      const pts = hit?.[1] ?? 0;
      total += pts;
      parts.push(`${row.type} ${a ? miles(a.distanceMiles) : "none"} → ${pts}`);
    }
    const earned = Math.min(total, cap, pointsParam(p) || Infinity);
    return {
      status: statusFromPoints(earned, pointsParam(p) || cap),
      pointsEarned: earned,
      actual: `${total} raw amenity points${total > cap ? ` (capped at ${cap})` : ""}`,
      expected: `Transit ≤⅓ mi 7, grocery ≤½ mi 5, park/library/school/medical 2–3, pharmacy 1–2 — max ${cap}${rural ? " (rural distances ×1.5)" : ""}`,
      explanation: earned >= cap ? "Maximum site amenity points." : `${cap - earned} amenity points left on the table.`,
      calculation: parts.join("; "),
      dataSources: amenitySources(ctx),
    };
  },

  bond_financing_test(ctx, p) {
    const threshold = Number(p?.threshold ?? 0.25);
    const aggregate = ctx.derived.eligibleBasis + ctx.project.landCost;
    const required = aggregate * threshold;
    return {
      status: "needs_info",
      pointsEarned: 0,
      actual: `Aggregate basis + land ≈ ${usd(aggregate)}; bond amount not yet specified`,
      expected: `Tax-exempt bonds ≥ ${pct(threshold, 0)} of aggregate basis + land ≈ ${usd(required)}`,
      explanation: `Confirm a private-activity bond allocation of at least ${usd(required)}. The 25% test applies to bonds issued after 12/31/2025 under the 2025 reconciliation act (P.L. 119-21) — verify with bond counsel.`,
      calculation: `(${usd(ctx.derived.eligibleBasis)} basis + ${usd(ctx.project.landCost)} land) × ${pct(threshold, 0)} = ${usd(required)}`,
      dataSources: [INTAKE, DERIVED],
    };
  },

  dscr_feasibility(ctx, p) {
    const uw = underwrite(ctx);
    const min = Number(p?.minLoanToCost ?? 0.15);
    const max = pointsParam(p);
    const ok = uw.noi > 0 && uw.loanToCost >= min;
    const earned = max ? Math.min(max, Math.round((max * uw.loanToCost) / Math.max(min * 2, 0.01))) : 0;
    return {
      status: ok ? (max && earned < max ? "partial" : "pass") : "fail",
      pointsEarned: ok ? earned : 0,
      actual: `NOI ${usd(uw.noi)}; supportable debt ${usd(uw.supportableLoan)} (${pct(uw.loanToCost)} of TDC)`,
      expected: `Positive NOI and supportable debt ≥ ${pct(min, 0)} of TDC at ${uw.dscr} DSCR`,
      explanation: ok ? "Proposed rents support meaningful permanent debt." : "Proposed rents do not support enough permanent debt.",
      calculation: `EGI ${usd(uw.effectiveGrossIncome)} − OpEx ${usd(uw.operatingExpenses)} = NOI ${usd(uw.noi)}; ÷ ${uw.dscr} DSCR → ${usd(uw.supportableLoan)}`,
      dataSources: [INTAKE, DERIVED],
    };
  },

  cdbg_eligible_activity(ctx) {
    const t = ctx.project.constructionType;
    const ok = t !== "new_construction";
    return {
      status: ok ? "pass" : "needs_info",
      pointsEarned: 0,
      actual: `Construction type: ${t.replace(/_/g, " ")}`,
      expected: "Acquisition, rehabilitation, or site/infrastructure costs (24 CFR 570.202 / 570.201(a)–(c))",
      explanation: ok
        ? "Rehabilitation / acquisition is an eligible CDBG activity."
        : "New construction is generally ineligible (24 CFR 570.207(b)(3)); structure CDBG for land acquisition, site prep or infrastructure, or via a CBDO.",
      dataSources: [INTAKE],
    };
  },

  requires_documentation(_ctx, p) {
    const item = String(p?.item ?? "Supporting documentation");
    return {
      status: "needs_info",
      pointsEarned: 0,
      actual: "Not yet documented",
      expected: item,
      explanation: `${item} must be documented by the applicant; it cannot be computed from intake data.`,
      dataSources: [],
    };
  },

  supportive_population(ctx, p) {
    const pop = ctx.project.targetPopulation;
    const ok = pop === "supportive" || pop === "special_needs";
    return {
      status: ok ? "pass" : "fail",
      pointsEarned: ok ? pointsParam(p) : 0,
      actual: `Target population: ${pop.replace(/_/g, " ")}`,
      expected: "Supportive or special-needs housing",
      explanation: ok ? "Serves a special-needs population." : "Program prioritizes supportive / special-needs housing.",
      dataSources: [INTAKE],
    };
  },
};

// ───────────────────────── Rule & program evaluation ─────────────────────────

export function evaluateRule(rule: Rule, ctx: EvaluationContext): RuleResult {
  const maxPoints = rule.kind === "points" ? rule.maxPoints ?? 0 : 0;
  let out: CheckOutcome;
  try {
    out = runCheck(rule.check, ctx, maxPoints);
  } catch (err) {
    out = {
      status: "needs_info",
      pointsEarned: 0,
      actual: "—",
      expected: rule.description,
      explanation: `Could not evaluate automatically (${(err as Error).message}).`,
      dataSources: [],
    };
  }
  // Threshold rules never award points; partial on a threshold means not met.
  const status: RuleStatus = rule.kind === "threshold" && out.status === "partial" ? "fail" : out.status;
  return {
    ruleId: rule.id,
    title: rule.title,
    kind: rule.kind,
    category: rule.category,
    citation: rule.citation,
    maxPoints,
    ...out,
    status,
    pointsEarned: rule.kind === "threshold" ? 0 : Math.max(0, Math.min(out.pointsEarned, maxPoints)),
  };
}

function recommendationsFor(results: RuleResult[]): string[] {
  const recs: { weight: number; text: string }[] = [];
  for (const r of results) {
    if (r.kind === "threshold" && r.status === "fail") {
      recs.push({ weight: 1000, text: `Resolve threshold "${r.title}" — required: ${r.expected}. ${r.explanation}` });
    } else if (r.kind === "threshold" && r.status === "needs_info") {
      recs.push({ weight: 500, text: `Document "${r.title}": ${r.expected}.` });
    } else if (r.kind === "points" && r.pointsEarned < r.maxPoints && r.status !== "needs_info") {
      const gap = r.maxPoints - r.pointsEarned;
      recs.push({ weight: gap, text: `+${gap} pts available: ${r.title} — ${r.expected}.` });
    } else if (r.kind === "points" && r.status === "needs_info") {
      recs.push({ weight: r.maxPoints / 2, text: `Provide data for "${r.title}" (up to ${r.maxPoints} pts).` });
    }
  }
  return recs
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map((r) => r.text);
}

export function evaluateProgram(program: FundingProgram, ctx: EvaluationContext): ProgramScore {
  const results = program.rules.map((r) => evaluateRule(r, ctx));
  const thresholds = results.filter((r) => r.kind === "threshold");
  const points = results.filter((r) => r.kind === "points");
  const thresholdsPassed = thresholds.filter((r) => r.status === "pass").length;
  const thresholdsFailed = thresholds.filter((r) => r.status === "fail").length;
  const thresholdsInfo = thresholds.filter((r) => r.status === "needs_info").length;
  const eligible = thresholdsFailed === 0;
  const pointsEarned = points.reduce((s, r) => s + r.pointsEarned, 0);
  const pointsPossible = points.reduce((s, r) => s + r.maxPoints, 0);
  const scorePct = pointsPossible > 0 ? pointsEarned / pointsPossible : 1;
  const thresholdRate = thresholds.length ? (thresholdsPassed + 0.5 * thresholdsInfo) / thresholds.length : 1;
  let fitScore = Math.round(100 * (0.4 * thresholdRate + 0.6 * scorePct));
  if (!eligible) fitScore = Math.min(fitScore, 35);

  const award = estimateAward(program, ctx);
  const estimatedAward = eligible ? Math.round(award.amount) : 0;
  const awardBasis = eligible ? award.basis : `Not eligible as proposed. If thresholds are resolved: ~${usd(award.amount)} (${award.basis})`;

  const summary = eligible
    ? `Eligible${thresholdsInfo ? ` pending ${thresholdsInfo} item${thresholdsInfo > 1 ? "s" : ""} to document` : ""} — ${thresholdsPassed}/${thresholds.length} thresholds met, ${pointsEarned} of ${pointsPossible} competitive points (${pct(scorePct, 0)}). Est. ${usd(estimatedAward)}.`
    : `Not eligible as proposed — ${thresholdsFailed} threshold${thresholdsFailed > 1 ? "s" : ""} failed (${thresholds
        .filter((r) => r.status === "fail")
        .map((r) => r.title)
        .join(", ")}).`;

  return {
    programId: program.id,
    eligible,
    thresholdsPassed,
    thresholdsTotal: thresholds.length,
    pointsEarned,
    pointsPossible,
    scorePct,
    fitScore,
    estimatedAward,
    awardBasis,
    results,
    summary,
    recommendations: recommendationsFor(results),
  };
}

/** Plain-text description of the RuleCheck DSL for the LLM rule-extraction prompt. */
export function describeDslForLLM(): string {
  const fields = Object.entries(FIELD_INFO)
    .map(([path, f]) => `  - ${path} (${f.format}${f.format === "pct" ? ", 0–1 fraction" : ""}): ${f.label}`)
    .join("\n");
  const enums = [
    "project.constructionType ∈ new_construction | acq_rehab | adaptive_reuse",
    "project.targetPopulation ∈ family | senior | supportive | special_needs",
    "project.greenBuilding ∈ none | enterprise_green | leed | passive_house",
    "geo.opportunityArea ∈ highest | high | moderate | low | high_segregation_poverty",
  ].join("\n  - ");
  const customs = Object.entries(CUSTOM_DOCS)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");
  return `Each rule has: id (kebab-case), category (threshold | scoring | set_aside | financial | location | readiness),
kind ("threshold" = must pass to be eligible, no points; "points" = competitive scoring with maxPoints),
title, description, citation (section of the source document), maxPoints (points rules only), and check.

check is one of (JSON):
  {"op":"gte"|"lte"|"gt"|"lt"|"eq"|"neq","field":<path>,"value":<number|string|boolean>}
  {"op":"in","field":<path>,"value":[...]}
  {"op":"truthy"|"falsy","field":<path>}
  {"op":"tiered","field":<path>,"direction":"higher_better"|"lower_better","tiers":[{"threshold":n,"points":n},...]}
  {"op":"amenity","amenityType":"transit"|"grocery"|"school"|"park"|"pharmacy"|"library"|"medical","tiers":[{"maxMiles":n,"points":n},...]}
  {"op":"custom","fn":<name>,"params":{...}}
  {"op":"all"|"any","checks":[<check>,...]}

Percent fields are fractions (0.4 = 40%). AMI fields are percents (60 = 60% AMI). Money is USD.

Available field paths:
${fields}

Enumerations:
  - ${enums}

Custom functions (op "custom"):
${customs}

Only use the fields and functions above. If a requirement cannot be expressed with them, use
{"op":"custom","fn":"requires_documentation","params":{"item":"<what must be documented>"}}.`;
}
