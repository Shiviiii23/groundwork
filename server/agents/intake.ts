import type { Agent } from "./context";
import { usd } from "./context";

const STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" "));

export const intakeAgent: Agent = async (ctx) => {
  const p = ctx.project.input;
  ctx.step("info", `Received intake for "${p.name}"`);
  await ctx.pause();

  p.state = p.state.trim().toUpperCase();
  p.zip = p.zip.trim();
  if (!STATES.has(p.state)) throw new Error(`Unrecognized state code "${p.state}"`);
  ctx.progress(20);

  const units = p.unitMix.reduce((s, r) => s + r.count, 0);
  if (units <= 0) throw new Error("Unit mix has no units");
  const byTier = new Map<number, number>();
  for (const r of p.unitMix) byTier.set(r.targetAmiPct, (byTier.get(r.targetAmiPct) ?? 0) + r.count);
  ctx.step(
    "result",
    `Normalized unit mix: ${units} units`,
    [...byTier.entries()].sort((a, b) => a[0] - b[0]).map(([ami, n]) => `${n} @ ${ami >= 120 ? "market" : `${ami}% AMI`}`).join(" · "),
  );
  ctx.progress(45);
  await ctx.pause();

  const warnings: string[] = [];
  const perUnit = p.totalDevelopmentCost / units;
  ctx.step("info", `Total development cost ${usd(p.totalDevelopmentCost)} → ${usd(perUnit)} per unit`);
  if (perUnit > 900_000) warnings.push(`Cost per unit ${usd(perUnit)} is above typical caps; many QAPs penalize or cap this`);
  if (perUnit < 120_000) warnings.push(`Cost per unit ${usd(perUnit)} looks low for ${p.constructionType.replace("_", " ")} — double-check TDC`);
  if (p.landCost >= p.totalDevelopmentCost) warnings.push("Land cost is ≥ total development cost");
  if (!p.siteControl) warnings.push("No site control yet — a threshold requirement for most competitive programs");
  if (!p.zoningApproved) warnings.push("Zoning not yet approved — readiness points at risk");
  for (const r of p.unitMix) {
    if (r.proposedRent <= 0) warnings.push(`${r.bedrooms}BR @ ${r.targetAmiPct}% AMI has no proposed rent`);
  }
  if (p.affordabilityPeriodYears < 15) warnings.push(`Affordability period ${p.affordabilityPeriodYears} yrs is below the LIHTC 15-yr compliance period`);
  ctx.progress(75);
  await ctx.pause();

  for (const w of warnings) ctx.step("warn", w);
  if (!warnings.length) ctx.step("result", "No intake issues found");
  ctx.saveProject();
  ctx.progress(100);
  return `${units} units in ${p.city}, ${p.state} · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`;
};
