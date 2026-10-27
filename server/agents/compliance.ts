import type { ComplianceCategory } from "../../shared/types";
import type { Agent } from "./context";

const CAT_LABEL: Record<ComplianceCategory, string> = {
  income: "income limits",
  rent: "rent limits",
  set_aside: "set-asides",
  occupancy: "occupancy",
  reporting: "reporting",
  physical: "inspections",
  affordability_term: "affordability term",
};

export const complianceAgent: Agent = async (ctx) => {
  const { project } = ctx;
  const eligibleIds = new Set(project.scores.filter((s) => s.eligible).map((s) => s.programId));
  const programs = project.programs.filter((p) => eligibleIds.has(p.id) || p.pursuit === "applying" || p.pursuit === "awarded");
  const byCat = new Map<ComplianceCategory, number>();
  let total = 0;
  for (const [i, prog] of programs.entries()) {
    if (!prog.complianceRules.length) continue;
    ctx.step(
      "result",
      `${prog.shortName}: ${prog.complianceRules.length} obligations`,
      prog.complianceRules.map((c) => `• [${c.frequency}] ${c.title} — ${c.citation}`).join("\n"),
    );
    for (const c of prog.complianceRules) byCat.set(c.category, (byCat.get(c.category) ?? 0) + 1);
    total += prog.complianceRules.length;
    ctx.progress(((i + 1) / programs.length) * 90);
    await ctx.pause(120, 300);
  }
  const mix = [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n} ${CAT_LABEL[c]}`).join(" · ");
  if (total) ctx.step("info", `Compliance index built: ${mix}`, "Track these on the Compliance dashboard once a program is marked awarded");
  else ctx.step("warn", "No eligible programs with compliance rules yet");
  ctx.progress(100);
  return `${total} obligations across ${programs.length} eligible/pursued programs`;
};
