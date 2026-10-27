import type { FundingProgram, ProgramScore } from "./types";

/**
 * Total funding identified across eligible programs. 9% and 4% LIHTC (4% is typed "bond")
 * are mutually exclusive, so only the largest tax-credit award counts; mortgage insurance is debt,
 * not subsidy, so it is left out.
 */
export function fundingIdentified(programs: FundingProgram[], scores: ProgramScore[]): number {
  const byId = new Map(programs.map((p) => [p.id, p]));
  const eligible = scores.filter((s) => s.eligible);
  const isCredit = (id: string) => ["tax_credit", "bond"].includes(byId.get(id)?.awardType ?? "");
  const credits = eligible.filter((s) => isCredit(s.programId));
  const other = eligible.filter((s) => !isCredit(s.programId) && byId.get(s.programId)?.awardType !== "loan_insurance");
  return Math.max(0, ...credits.map((s) => s.estimatedAward)) + other.reduce((sum, s) => sum + s.estimatedAward, 0);
}
