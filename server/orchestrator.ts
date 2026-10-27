import type { AgentId, FundingProgram, Project, Run } from "../shared/types";
import { complianceAgent } from "./agents/compliance";
import { type Agent, makeCtx, newTask } from "./agents/context";
import { discoveryAgent } from "./agents/discovery";
import { extractInto, extractionAgent } from "./agents/extraction";
import { geoAgent } from "./agents/geo";
import { intakeAgent } from "./agents/intake";
import { scoringAgent } from "./agents/scoring";
import { llmEnabled } from "./llm";
import { newId, store } from "./store";

const AGENTS: Record<AgentId, Agent> = {
  intake: intakeAgent,
  geo: geoAgent,
  discovery: discoveryAgent,
  extraction: extractionAgent,
  scoring: scoringAgent,
  compliance: complianceAgent,
};

function createRun(project: Project, agents: AgentId[]): Run {
  const run: Run = {
    id: newId("run"),
    projectId: project.id,
    status: "running",
    startedAt: new Date().toISOString(),
    llmEnabled: llmEnabled(),
    tasks: agents.map(newTask),
  };
  project.latestRunId = run.id;
  store.saveProject(project);
  store.saveRun(run);
  return run;
}

/** Runs one agent task; returns false if it failed (errors never escape). */
async function runTask(project: Project, run: Run, agent: AgentId, impl: Agent = AGENTS[agent]): Promise<boolean> {
  const task = run.tasks.find((t) => t.agent === agent)!;
  const ctx = makeCtx(project, run, task);
  task.status = "running";
  task.startedAt = new Date().toISOString();
  store.saveRun(run);
  try {
    task.summary = await impl(ctx);
    task.status = "done";
    task.progress = 100;
    return true;
  } catch (err) {
    task.status = "error";
    task.summary = (err as Error).message;
    ctx.step("error", (err as Error).message);
    return false;
  } finally {
    task.finishedAt = new Date().toISOString();
    store.saveRun(run);
  }
}

function skip(run: Run, agent: AgentId, reason: string): void {
  const task = run.tasks.find((t) => t.agent === agent)!;
  task.status = "skipped";
  task.summary = reason;
  task.finishedAt = new Date().toISOString();
  store.saveRun(run);
}

function finish(run: Run, ok: boolean): void {
  run.status = ok ? "complete" : "error";
  run.finishedAt = new Date().toISOString();
  store.saveRun(run);
}

/** Full pipeline: intake → (geo ∥ discovery) → extraction → scoring → compliance. */
export function startRun(project: Project): Run {
  const run = createRun(project, ["intake", "geo", "discovery", "extraction", "scoring", "compliance"]);
  void (async () => {
    if (!(await runTask(project, run, "intake"))) {
      for (const a of ["geo", "discovery", "extraction", "scoring", "compliance"] as AgentId[]) skip(run, a, "Skipped: intake failed");
      return finish(run, false);
    }
    const [geoOk, discOk] = await Promise.all([runTask(project, run, "geo"), runTask(project, run, "discovery")]);
    const extractOk = discOk ? await runTask(project, run, "extraction") : (skip(run, "extraction", "Skipped: discovery failed"), false);
    const scoreOk = geoOk && extractOk ? await runTask(project, run, "scoring") : (skip(run, "scoring", "Skipped: missing geo or rules"), false);
    const compOk = scoreOk ? await runTask(project, run, "compliance") : (skip(run, "compliance", "Skipped: scoring did not run"), false);
    finish(run, geoOk && discOk && extractOk && scoreOk && compOk);
  })();
  return run;
}

/** Uploaded funding document: extraction → scoring → compliance on a new program. */
export function startDocumentRun(project: Project, doc: { title: string; url?: string; text: string }): Run {
  const id = `doc-${Date.now().toString(36)}`;
  const program: FundingProgram = {
    id,
    name: doc.title,
    shortName: doc.title.slice(0, 24),
    type: "local_program",
    awardType: "soft_loan",
    administrator: "Uploaded document",
    jurisdiction: project.input.state,
    description: `Rules extracted from an uploaded document (${doc.text.length.toLocaleString()} characters).`,
    typicalAward: "See document",
    applicationCycle: "See document",
    url: doc.url ?? "",
    sourceDocument: { title: doc.title, url: doc.url ?? "" },
    discoveredBy: "uploaded_document",
    rules: [],
    complianceRules: [],
  };
  const run = createRun(project, ["extraction", "scoring", "compliance"]);
  void (async () => {
    const extracted = await runTask(project, run, "extraction", async (ctx) => {
      ctx.step("tool", `Claude: extracting rules from "${doc.title}"`, `${doc.text.length.toLocaleString()} characters`);
      ctx.progress(15);
      await extractInto(ctx, program, doc.text);
      if (!program.rules.length) throw new Error("No scoreable rules could be extracted from the document");
      project.programs = [...project.programs.filter((p) => p.id !== id), program];
      ctx.saveProject();
      ctx.step("result", `${program.name}: ${program.rules.length} rules, ${program.complianceRules.length} compliance obligations`);
      return `Added ${program.shortName} with ${program.rules.length} rules`;
    });
    if (!extracted) {
      skip(run, "scoring", "Skipped: extraction failed");
      skip(run, "compliance", "Skipped: extraction failed");
      return finish(run, false);
    }
    const scoreOk = project.geo ? await runTask(project, run, "scoring") : (skip(run, "scoring", "Skipped: project has no geo context — rerun the full pipeline"), false);
    const compOk = scoreOk ? await runTask(project, run, "compliance") : (skip(run, "compliance", "Skipped"), false);
    finish(run, scoreOk && compOk);
  })();
  return run;
}
