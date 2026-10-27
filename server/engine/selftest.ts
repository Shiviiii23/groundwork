// Engine self-test: runs every sample project through its program catalog and the
// compliance evaluator with a synthetic geo context. `npm run test:engine`.

import assert from "node:assert/strict";
import type { GeoContext, Project } from "../../shared/types";
import { catalogForProject, PROGRAM_CATALOG } from "../data/programs";
import { SAMPLE_PROJECTS } from "../data/samples";
import { evaluateCompliance, parseRentRollCsv, sampleComplianceData } from "./compliance";
import { deriveMetrics } from "./derive";
import { describeDslForLLM, evaluateProgram } from "./evaluate";
import { usd } from "./format";
import { incomeLimit, rentLimit } from "./limits";

const SYNTHETIC: Record<string, Partial<GeoContext>> = {
  CA: { areaMedianIncome: 150_000, isQCT: true, isDDA: true, povertyRate: 0.24, opportunityArea: "moderate", countyName: "Alameda County" },
  TX: { areaMedianIncome: 126_000, isQCT: false, isDDA: false, povertyRate: 0.19, opportunityArea: "moderate", countyName: "Travis County" },
  NY: { areaMedianIncome: 162_000, isQCT: true, isDDA: true, povertyRate: 0.41, opportunityArea: "high_segregation_poverty", countyName: "Bronx County" },
};

function syntheticGeo(state: string, amenities: GeoContext["amenities"]): GeoContext {
  return {
    lat: 0,
    lng: 0,
    matchedAddress: "synthetic",
    stateFips: "00",
    countyFips: "000",
    tractCode: "000100",
    geoid: "00000000100",
    countyName: "Test County",
    tractName: "Census Tract 1",
    population: 4200,
    tractMedianHouseholdIncome: 52_000,
    areaMedianIncome: 100_000,
    povertyRate: 0.2,
    renterShare: 0.7,
    rentBurdenedShare: 0.55,
    unemploymentRate: 0.07,
    isQCT: false,
    qctBasis: "estimated_from_acs",
    isDDA: false,
    isRural: false,
    opportunityArea: "moderate",
    amenities,
    sources: [{ name: "Synthetic test data", live: false, retrievedAt: new Date().toISOString() }],
    ...SYNTHETIC[state],
  };
}

// Limits sanity: HUD 4-person 50% of $100k = $50,000; 2BR @ 60% imputes 3 persons.
assert.equal(incomeLimit(100_000, 50, 4), 50_000);
assert.equal(incomeLimit(100_000, 60, 1), 42_000);
assert.equal(rentLimit(100_000, 60, 2), Math.floor((54_000 * 0.3) / 12));

// Every program's rule ids are unique and well-formed.
const ids = new Set<string>();
for (const p of PROGRAM_CATALOG) {
  assert.ok(p.rules.length >= 4, `${p.id} has too few rules`);
  for (const r of p.rules) {
    assert.ok(!ids.has(r.id), `duplicate rule id ${r.id}`);
    ids.add(r.id);
    if (r.kind === "points") assert.ok((r.maxPoints ?? 0) > 0, `${r.id} missing maxPoints`);
  }
}
assert.ok(describeDslForLLM().includes("derived.pctUnitsAt60"));

for (const sample of SAMPLE_PROJECTS) {
  const geo = syntheticGeo(sample.input.state, sample.input.amenitiesNearby ?? []);
  const derived = deriveMetrics(sample.input, geo);
  const programs = catalogForProject(sample.input);
  const ctx = { project: sample.input, geo, derived };
  console.log(
    `\n▌ ${sample.label}  — ${derived.totalUnits} units, ${usd(derived.costPerUnit)}/unit, AF ${(derived.applicableFraction * 100).toFixed(0)}%, ${derived.unitsOverRentLimit} units over rent limit`,
  );
  const scores = programs.map((p) => ({ p, s: evaluateProgram(p, ctx) })).sort((a, b) => b.s.fitScore - a.s.fitScore);
  for (const { p, s } of scores) {
    assert.ok(s.fitScore >= 0 && s.fitScore <= 100, "fitScore out of range");
    assert.ok(s.pointsEarned <= s.pointsPossible, "points overflow");
    assert.ok(Number.isFinite(s.estimatedAward) && s.estimatedAward >= 0, "bad award");
    assert.equal(s.results.length, p.rules.length);
    console.log(
      `  ${p.shortName.padEnd(18)} fit ${String(s.fitScore).padStart(3)}  ${s.eligible ? "eligible  " : "INELIGIBLE"}  thr ${s.thresholdsPassed}/${s.thresholdsTotal}  pts ${String(s.pointsEarned).padStart(3)}/${String(s.pointsPossible).padEnd(3)}  ${usd(s.estimatedAward).padStart(8)}`,
    );
  }
  const top = scores[0].s;
  console.log(`  top recommendation: ${top.recommendations[0] ?? "(none)"}`);

  const project: Project = {
    id: sample.id,
    createdAt: "",
    updatedAt: "",
    input: sample.input,
    geo,
    derived,
    programs,
    scores: scores.map((x) => x.s),
  };
  project.compliance = sampleComplianceData(project);
  const report = evaluateCompliance(project);
  assert.equal(report.units.length, derived.totalUnits);
  assert.ok(report.findings.length > 0);
  assert.ok(report.findings.some((f) => f.status === "violation"), "sample data should include violations");
  const counts = report.findings.reduce<Record<string, number>>((m, f) => ((m[f.status] = (m[f.status] ?? 0) + 1), m), {});
  console.log(
    `  compliance [${report.programIds.join(", ")}]: overall ${report.overall}, ${(report.scorePct * 100).toFixed(0)}% compliant ${JSON.stringify(counts)}, ${report.units.filter((u) => u.status !== "compliant").length} units flagged, next due: ${report.upcoming[0]?.title ?? "—"} ${report.upcoming[0]?.dueDate ?? ""}`,
  );
}

// CSV round trip.
const parsed = parseRentRollCsv(
  'Unit,BR,AMI,HH Size,Move-in Income,Current Income,Rent,UA,Move In,Last Cert,Students,Vacant\n101,2,60,3,"$48,000",49000,1500,120,2024-01-15,2025-01-10,no,no\n102,1,50,1,30000,30000,1100,90,2024-03-01,2025-02-01,yes,no',
);
assert.equal(parsed.length, 2);
assert.equal(parsed[0].annualIncomeAtMoveIn, 48_000);
assert.equal(parsed[1].allFullTimeStudents, true);

console.log("\n✓ engine self-test passed");
