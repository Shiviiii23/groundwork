import type { FundingProgram } from "../../shared/types";
import { catalogForProject } from "../data/programs";
import { discoverPrograms, llmEnabled } from "../llm";
import type { Agent } from "./context";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const TYPE_LABEL: Record<FundingProgram["type"], string> = {
  federal_tax_credit: "federal tax credit",
  federal_grant: "federal grant",
  federal_loan: "federal loan",
  state_program: "state program",
  local_program: "local program",
  private: "private",
};

export const discoveryAgent: Agent = async (ctx) => {
  const p = ctx.project.input;
  const previous = new Map(ctx.project.programs.map((pr) => [pr.id, pr]));

  ctx.step("tool", `Searching funding knowledge base: federal programs + ${p.state} state programs`, `filters: state=${p.state}, population=${p.targetPopulation}, type=${p.constructionType}`);
  await ctx.pause(300, 700);
  const catalog = catalogForProject(p);
  const programs: FundingProgram[] = [];
  for (const [i, prog] of catalog.entries()) {
    programs.push(prog);
    ctx.step("result", `Found ${prog.name}`, `${prog.administrator} · ${TYPE_LABEL[prog.type]} · ${prog.typicalAward}`);
    ctx.progress(10 + (i / Math.max(1, catalog.length)) * 40);
    await ctx.pause(120, 350);
  }

  let webFound = 0;
  if (llmEnabled()) {
    ctx.step("tool", `Claude web search: state & local programs for ${p.city}, ${p.state}`, "web_search_20260209 · up to 6 searches");
    try {
      const { programs: found, searches } = await discoverPrograms(p, programs.map((x) => x.name));
      ctx.step("info", `Ran ${searches} web searches, ${found.length} candidate programs returned`);
      const seen = new Set(programs.map((x) => norm(x.name)));
      for (const f of found) {
        if (seen.has(norm(f.name))) continue;
        seen.add(norm(f.name));
        const id = `web-${slug(f.shortName || f.name)}`;
        programs.push({
          id,
          name: f.name,
          shortName: f.shortName,
          type: f.type,
          awardType: f.awardType,
          administrator: f.administrator,
          jurisdiction: f.jurisdiction,
          description: f.description,
          typicalAward: f.typicalAward,
          applicationCycle: f.applicationCycle,
          url: f.url,
          sourceDocument: f.sourceDocument,
          discoveredBy: "web_search",
          rules: [],
          complianceRules: [],
        });
        webFound++;
        ctx.step("result", `Found ${f.name} (web)`, `${f.administrator} · ${f.url}`);
        await ctx.pause(100, 250);
      }
    } catch (err) {
      ctx.step("warn", `Web search failed: ${(err as Error).message}`);
    }
  } else {
    ctx.step("warn", "Live web search disabled — set ANTHROPIC_API_KEY to discover additional state & local programs");
  }

  // Keep documents the user uploaded earlier and preserve pursuit statuses across reruns.
  for (const old of previous.values()) {
    if (old.discoveredBy === "uploaded_document" && !programs.some((x) => x.id === old.id)) programs.push(old);
  }
  for (const prog of programs) {
    const old = previous.get(prog.id);
    if (old?.pursuit) prog.pursuit = old.pursuit;
  }

  ctx.project.programs = programs;
  ctx.saveProject();
  ctx.progress(100);
  return `${programs.length} funding sources (${catalog.length} knowledge base${webFound ? `, ${webFound} from web search` : ""})`;
};
