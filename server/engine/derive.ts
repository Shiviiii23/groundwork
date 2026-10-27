// Derived project metrics: unit targeting shares, cost ratios, LIHTC basis math
// and per-tier rent limits. Pure function of client intake + geo context.

import type { DerivedMetrics, GeoContext, ProjectInput } from "../../shared/types";
import { rentLimit } from "./limits";

/** Share of (TDC − land) assumed to be depreciable eligible basis. */
export const ELIGIBLE_BASIS_SHARE = 0.9;
/** QCT/DDA basis boost under IRC §42(d)(5)(B). */
export const BASIS_BOOST = 1.3;

const STANDARD_TIERS = [30, 40, 50, 60, 70, 80];
const BEDROOM_SIZES = [0, 1, 2, 3, 4];

export function deriveMetrics(input: ProjectInput, geo: GeoContext): DerivedMetrics {
  const rows = input.unitMix.filter((r) => r.count > 0);
  const totalUnits = rows.reduce((s, r) => s + r.count, 0);
  const unitsAtOrBelow = (ami: number) => rows.filter((r) => r.targetAmiPct <= ami).reduce((s, r) => s + r.count, 0);
  const share = (n: number) => (totalUnits > 0 ? n / totalUnits : 0);

  const affordableUnits = unitsAtOrBelow(80);
  const affordableRows = rows.filter((r) => r.targetAmiPct <= 80);
  const averageAmiOfAffordable =
    affordableUnits > 0 ? affordableRows.reduce((s, r) => s + r.targetAmiPct * r.count, 0) / affordableUnits : 0;

  // Income averaging (IRC §42(g)(1)(C)) lets units up to 80% AMI count when the
  // average designation is ≤ 60%; otherwise only ≤ 60% units are tax-credit units.
  const lihtcUnits = averageAmiOfAffordable > 0 && averageAmiOfAffordable <= 60 ? affordableUnits : unitsAtOrBelow(60);
  const applicableFraction = share(lihtcUnits);

  const tdc = Math.max(0, input.totalDevelopmentCost);
  const eligibleBasis = Math.max(0, tdc - input.landCost) * ELIGIBLE_BASIS_SHARE;
  const basisBoostEligible = geo.isQCT || geo.isDDA;
  const adjustedEligibleBasis = eligibleBasis * (basisBoostEligible ? BASIS_BOOST : 1);

  const tiers = Array.from(new Set([...STANDARD_TIERS, ...rows.map((r) => r.targetAmiPct).filter((a) => a <= 80)])).sort(
    (a, b) => a - b,
  );
  const maxRentByTier: DerivedMetrics["maxRentByTier"] = {};
  for (const tier of tiers) {
    maxRentByTier[String(tier)] = {};
    for (const br of Array.from(new Set([...BEDROOM_SIZES, ...rows.map((r) => r.bedrooms)]))) {
      maxRentByTier[String(tier)][String(br)] = rentLimit(geo.areaMedianIncome, tier, br);
    }
  }

  const unitsOverRentLimit = affordableRows
    .filter((r) => r.proposedRent > rentLimit(geo.areaMedianIncome, r.targetAmiPct, r.bedrooms))
    .reduce((s, r) => s + r.count, 0);

  return {
    totalUnits,
    affordableUnits,
    pctUnitsAt30: share(unitsAtOrBelow(30)),
    pctUnitsAt50: share(unitsAtOrBelow(50)),
    pctUnitsAt60: share(unitsAtOrBelow(60)),
    pctUnitsAt80: share(affordableUnits),
    averageAmiOfAffordable,
    costPerUnit: totalUnits > 0 ? tdc / totalUnits : 0,
    landCostPerUnit: totalUnits > 0 ? input.landCost / totalUnits : 0,
    eligibleBasis,
    basisBoostEligible,
    adjustedEligibleBasis,
    applicableFraction,
    localLeverageRatio: tdc > 0 ? input.committedLocalFunds / tdc : 0,
    unitsOverRentLimit,
    maxRentByTier,
  };
}
