// HUD / LIHTC income and rent limit math.
//
// Income limits follow HUD's household-size adjustment of the 4-person base
// (70% / 80% / 90% / 100% / 108% / 116% / 124% / 132%, +8 pts per extra person).
// LIHTC gross rent limits impute household size at 1.5 persons per bedroom
// (1 person for studios) per IRC §42(g)(2)(C), capped at 30% of the imputed
// income limit.

const SIZE_ADJUSTMENT = [0.7, 0.8, 0.9, 1.0, 1.08, 1.16, 1.24, 1.32];

function sizeAdjustment(householdSize: number): number {
  const size = Math.max(1, Math.round(householdSize));
  if (size <= SIZE_ADJUSTMENT.length) return SIZE_ADJUSTMENT[size - 1];
  return 1.32 + 0.08 * (size - 8);
}

/** Annual income limit (USD) for a household at `amiPct` of a 4-person `ami4`. HUD rounds up to the nearest $50. */
export function incomeLimit(ami4: number, amiPct: number, householdSize: number): number {
  const raw = ami4 * (amiPct / 100) * sizeAdjustment(householdSize);
  return Math.ceil(raw / 50) * 50;
}

/** Imputed household size for LIHTC rent limits: 1 for studios, 1.5 per bedroom otherwise. */
export function imputedHouseholdSize(bedrooms: number): number {
  return bedrooms <= 0 ? 1 : bedrooms * 1.5;
}

/** Maximum monthly gross rent (tenant rent + utility allowance) for a unit restricted at `amiPct`. */
export function rentLimit(ami4: number, amiPct: number, bedrooms: number): number {
  const size = imputedHouseholdSize(bedrooms);
  const lower = Math.floor(size);
  const upper = Math.ceil(size);
  // Fractional sizes (1.5, 4.5 persons) average the adjacent income limits.
  const annual =
    lower === upper
      ? incomeLimit(ami4, amiPct, lower)
      : (incomeLimit(ami4, amiPct, lower) + incomeLimit(ami4, amiPct, upper)) / 2;
  return Math.floor((annual * 0.3) / 12);
}
