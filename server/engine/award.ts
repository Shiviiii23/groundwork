// Award estimates per funding program, plus a simple underwriting model used by
// the 221(d)(4) and feasibility checks. Numbers are planning-grade estimates.

import type { EvaluationContext, FundingProgram } from "../../shared/types";
import { pct, usd } from "./format";

const VACANCY = 0.05;
const OPEX_PER_UNIT = 9_000; // annual operating expenses incl. replacement reserves
const UTILITY_ALLOWANCE = 90; // avg monthly UA deducted from gross rent
const LOAN_RATE = 0.0625; // HUD-insured permanent rate assumption
const MIP = 0.0025; // annual mortgage insurance premium (affordable)
const AMORT_YEARS = 40;

export interface Underwriting {
  effectiveGrossIncome: number;
  operatingExpenses: number;
  noi: number;
  dscr: number;
  supportableLoan: number;
  loanToCost: number;
}

/** Sizes a permanent loan from the client's proposed rents. */
export function underwrite(ctx: EvaluationContext): Underwriting {
  const { project, derived } = ctx;
  const grossPotentialRent = project.unitMix.reduce(
    (s, r) => s + r.count * Math.max(0, r.proposedRent - UTILITY_ALLOWANCE) * 12,
    0,
  );
  const effectiveGrossIncome = grossPotentialRent * (1 - VACANCY);
  const operatingExpenses = derived.totalUnits * OPEX_PER_UNIT;
  const noi = effectiveGrossIncome - operatingExpenses;
  // HUD MAP: 1.15 DSCR for affordable (≥ 90% restricted), 1.176 otherwise.
  const dscr = derived.pctUnitsAt80 >= 0.9 ? 1.15 : 1.176;
  const monthly = (LOAN_RATE + MIP) / 12;
  const n = AMORT_YEARS * 12;
  const constant = (monthly / (1 - Math.pow(1 + monthly, -n))) * 12;
  const byDebtService = noi > 0 ? noi / dscr / constant : 0;
  const ltcCap = project.totalDevelopmentCost * (derived.pctUnitsAt80 >= 0.9 ? 0.9 : 0.87);
  const supportableLoan = Math.max(0, Math.min(byDebtService, ltcCap));
  return {
    effectiveGrossIncome,
    operatingExpenses,
    noi,
    dscr,
    supportableLoan,
    loanToCost: project.totalDevelopmentCost > 0 ? supportableLoan / project.totalDevelopmentCost : 0,
  };
}

interface AwardEstimate {
  amount: number;
  basis: string;
}

function taxCredit(ctx: EvaluationContext, rate: number, price: number, annualCap?: number): AwardEstimate {
  const d = ctx.derived;
  const qualifiedBasis = d.adjustedEligibleBasis * d.applicableFraction;
  const uncapped = qualifiedBasis * rate;
  const annual = annualCap ? Math.min(uncapped, annualCap) : uncapped;
  const equity = annual * 10 * price;
  const boost = d.basisBoostEligible ? " incl. 130% QCT/DDA boost" : "";
  const cap = annualCap && uncapped > annualCap ? `, capped at ${usd(annualCap)}/yr per-project limit` : "";
  return {
    amount: equity,
    basis: `Qualified basis ${usd(qualifiedBasis)} (${usd(d.adjustedEligibleBasis)} adj. eligible basis${boost} × ${pct(
      d.applicableFraction,
    )} applicable fraction) × ${(rate * 100).toFixed(0)}% = ${usd(annual)}/yr credits${cap} × 10 yrs × $${price.toFixed(
      2,
    )} equity price`,
  };
}

function perUnit(units: number, perUnitAmount: number, cap: number, label: string): AwardEstimate {
  const raw = units * perUnitAmount;
  const amount = Math.min(raw, cap);
  return {
    amount,
    basis: `${units} ${label} × ${usd(perUnitAmount)}/unit = ${usd(raw)}${raw > cap ? `, capped at ${usd(cap)} program maximum` : ""}`,
  };
}

/** Estimated award (USD) for a program — equity for tax credits, loan/grant amount otherwise. */
export function estimateAward(program: FundingProgram, ctx: EvaluationContext): AwardEstimate {
  const d = ctx.derived;
  const units30 = Math.round(d.pctUnitsAt30 * d.totalUnits);
  const units50 = Math.round(d.pctUnitsAt50 * d.totalUnits);
  switch (program.id) {
    case "fed-lihtc-9":
      return taxCredit(ctx, 0.09, 0.88, 1_750_000);
    case "ca-tcac-9":
      return taxCredit(ctx, 0.09, 0.9, 2_500_000);
    case "tx-tdhca-9":
      return taxCredit(ctx, 0.09, 0.87, 2_000_000);
    case "ny-hcr-9":
      return taxCredit(ctx, 0.09, 0.92, 2_200_000);
    case "fed-lihtc-4-bonds":
      return taxCredit(ctx, 0.04, 0.86);
    case "home":
      return perUnit(Math.min(d.affordableUnits, 20), 150_000, 3_000_000, "HOME-assisted units (≤ 20)");
    case "htf":
      return perUnit(units30, 175_000, 3_000_000, "units ≤ 30% AMI");
    case "cdbg": {
      const amount = Math.min(ctx.project.totalDevelopmentCost * 0.05, 2_000_000);
      return { amount, basis: `5% of TDC (${usd(ctx.project.totalDevelopmentCost)}), capped at $2.0M typical local allocation` };
    }
    case "fhlb-ahp":
      return perUnit(units50, 25_000, 1_000_000, "units ≤ 50% AMI");
    case "hud-811-pra": {
      const units811 = Math.floor(d.totalUnits * 0.25);
      const annual = units811 * 1_100 * 12;
      return {
        amount: annual * 20,
        basis: `${units811} PRA units (≤ 25% cap) × ~$1,100/mo subsidy × 12 = ${usd(annual)}/yr over a 20-yr contract`,
      };
    }
    case "hud-221d4": {
      const uw = underwrite(ctx);
      return {
        amount: uw.supportableLoan,
        basis: `NOI ${usd(uw.noi)} ÷ ${uw.dscr} DSCR at ${(LOAN_RATE * 100).toFixed(2)}% + ${MIP * 100}% MIP, 40-yr amortization → ${usd(
          uw.supportableLoan,
        )} insured loan (${pct(uw.loanToCost)} of TDC)`,
      };
    }
    case "ca-hcd-mhp":
      return perUnit(d.affordableUnits, 200_000, 20_000_000, "restricted units");
    case "ca-ahsc":
      return perUnit(d.affordableUnits, 250_000, 35_000_000, "restricted units (AHD loan)");
    case "tx-tdhca-mfdl":
      return perUnit(units50, 70_000, 3_000_000, "units ≤ 50% AMI");
    case "ny-htf":
      return perUnit(d.affordableUnits, 125_000, 6_000_000, "restricted units");
  }
  // Programs discovered by search or uploaded documents: estimate by award type.
  switch (program.awardType) {
    case "tax_credit":
      return taxCredit(ctx, 0.09, 0.88, 2_000_000);
    case "bond":
      return taxCredit(ctx, 0.04, 0.86);
    case "loan_insurance": {
      const uw = underwrite(ctx);
      return { amount: uw.supportableLoan, basis: `Supportable debt from NOI ${usd(uw.noi)} at ${uw.dscr} DSCR` };
    }
    default: {
      const raw = d.affordableUnits * 50_000;
      const cap = ctx.project.totalDevelopmentCost * 0.1;
      return {
        amount: Math.min(raw, cap),
        basis: `Generic estimate: ${d.affordableUnits} restricted units × $50k, capped at 10% of TDC (${usd(cap)})`,
      };
    }
  }
}
