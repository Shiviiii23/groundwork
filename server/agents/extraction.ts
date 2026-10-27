import type { FundingProgram } from "../../shared/types";
import { extractRules, llmEnabled } from "../llm";
import type { Agent, AgentCtx } from "./context";

function ruleBreakdown(p: FundingProgram): string {
  const t = p.rules.filter((r) => r.kind === "threshold").length;
  const pts = p.rules.filter((r) => r.kind === "points");
  const max = pts.reduce((s, r) => s + (r.maxPoints ?? 0), 0);
  return `${t} threshold${t === 1 ? "" : "s"}, ${pts.length} scoring criteria (${max} pts), ${p.complianceRules.length} compliance obligations`;
}

export async function extractInto(ctx: AgentCtx, prog: FundingProgram, docText?: string): Promise<void> {
  const res = await extractRules(prog.id, { name: prog.name, administrator: prog.administrator, url: prog.url }, docText);
  prog.rules = res.rules;
  prog.complianceRules = res.complianceRules;
  if (prog.discoveredBy === "uploaded_document" && res.program) {
    Object.assign(prog, {
      name: res.program.name || prog.name,
      shortName: (res.program.shortName || prog.shortName).slice(0, 24),
      administrator: res.program.administrator || prog.administrator,
      jurisdiction: res.program.jurisdiction || prog.jurisdiction,
      type: res.program.type || prog.type,
      awardType: res.program.awardType || prog.awardType,
      description: res.program.description || prog.description,
      typicalAward: res.program.typicalAward || prog.typicalAward,
      applicationCycle: res.program.applicationCycle || prog.applicationCycle,
    });
  }
  if (res.dropped) ctx.step("warn", `${prog.shortName}: dropped ${res.dropped} rule${res.dropped === 1 ? "" : "s"} that couldn't be expressed in the scoring DSL`);
}

export const extractionAgent: Agent = async (ctx) => {
  const programs = ctx.project.programs;
  const pending = programs.filter((p) => p.rules.length === 0);
  let i = 0;
  for (const prog of programs) {
    i++;
    if (prog.rules.length > 0) {
      ctx.step("tool", `Reading ${prog.sourceDocument.title}`, prog.sourceDocument.url);
      await ctx.pause(150, 400);
      ctx.step("result", `${prog.shortName}: ${ruleBreakdown(prog)}`);
    } else if (llmEnabled()) {
      ctx.step("tool", `Claude: extracting rules for ${prog.name}`, prog.url);
      try {
        await extractInto(ctx, prog);
        ctx.step("result", `${prog.shortName}: ${ruleBreakdown(prog)}`);
      } catch (err) {
        ctx.step("error", `${prog.shortName}: extraction failed — ${(err as Error).message}`);
      }
    } else {
      ctx.step("warn", `${prog.shortName}: no encoded rules and LLM extraction is disabled`);
    }
    ctx.progress((i / programs.length) * 100);
    ctx.saveProject();
  }
  const total = programs.reduce((s, p) => s + p.rules.length, 0);
  const comp = programs.reduce((s, p) => s + p.complianceRules.length, 0);
  return `${total} scoring/threshold rules and ${comp} compliance rules across ${programs.length} programs${pending.length ? ` (${pending.length} extracted by Claude)` : ""}`;
};
