import { deriveMetrics } from "../engine/derive";
import { evaluateProgram } from "../engine/evaluate";
import type { ProgramScore } from "../../shared/types";
import type { Agent } from "./context";
import { pct, usd } from "./context";

export const scoringAgent: Agent = async (ctx) => {
  const { project } = ctx;
  if (!project.geo) throw new Error("No geo context — geo agent did not complete");
  const geo = project.geo;

  ctx.step("info", "Deriving project metrics from intake + public data");
  const d = deriveMetrics(project.input, geo);
  project.derived = d;
  await ctx.pause();
  ctx.step("result", `Income targeting: ${pct(d.pctUnitsAt30, 0)} ≤30% · ${pct(d.pctUnitsAt50, 0)} ≤50% · ${pct(d.pctUnitsAt60, 0)} ≤60% AMI`, `Average AMI of affordable units: ${d.averageAmiOfAffordable.toFixed(1)}%`);
  ctx.step(
    "result",
    `Eligible basis ${usd(d.eligibleBasis)}${d.basisBoostEligible ? ` × 130% (${geo.isQCT ? "QCT" : "DDA"} boost) = ${usd(d.adjustedEligibleBasis)}` : ""}`,
    `(TDC ${usd(project.input.totalDevelopmentCost)} − land ${usd(project.input.landCost)}) × 90% depreciable · applicable fraction ${pct(d.applicableFraction)}`,
  );
  ctx.step("result", `Cost per unit ${usd(d.costPerUnit)} · local leverage ${pct(d.localLeverageRatio)} of TDC`);
  if (d.unitsOverRentLimit > 0) ctx.step("warn", `${d.unitsOverRentLimit} unit${d.unitsOverRentLimit === 1 ? "" : "s"} propose rents above the LIHTC max for their AMI tier`);
  else ctx.step("result", `All proposed rents are within LIHTC limits (AMI ${usd(geo.areaMedianIncome)})`);
  ctx.progress(20);
  await ctx.pause();

  const ctxEval = { project: project.input, geo, derived: d };
  const scorable = project.programs.filter((p) => p.rules.length > 0);
  const scores: ProgramScore[] = [];
  for (const [i, prog] of scorable.entries()) {
    ctx.step("tool", `Scoring ${prog.name} against ${prog.rules.length} rules`);
    const s = evaluateProgram(prog, ctxEval);
    scores.push(s);
    await ctx.pause(150, 450);
    const fails = s.results.filter((r) => r.kind === "threshold" && r.status === "fail");
    ctx.step(
      s.eligible ? "result" : "warn",
      `${prog.shortName}: ${s.eligible ? "eligible" : "not eligible"} · ${s.thresholdsPassed}/${s.thresholdsTotal} thresholds · ${s.pointsEarned}/${s.pointsPossible} pts · fit ${Math.round(s.fitScore)}`,
      [s.awardBasis, ...fails.map((f) => `✗ ${f.title}: ${f.actual} (needs ${f.expected})`)].filter(Boolean).join("\n"),
    );
    ctx.progress(20 + ((i + 1) / scorable.length) * 75);
  }
  scores.sort((a, b) => b.fitScore - a.fitScore);
  project.scores = scores;
  ctx.saveProject();
  ctx.progress(100);

  const eligible = scores.filter((s) => s.eligible);
  const top = scores[0] && project.programs.find((p) => p.id === scores[0].programId);
  return `${eligible.length}/${scores.length} programs eligible${top ? ` · top fit: ${top.shortName} (${Math.round(scores[0].fitScore)})` : ""}`;
};
