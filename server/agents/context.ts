import type { AgentId, AgentStep, AgentTask, Project, Run } from "../../shared/types";
import { store } from "../store";

export interface AgentCtx {
  project: Project;
  run: Run;
  task: AgentTask;
  step(level: AgentStep["level"], message: string, detail?: string): void;
  progress(pct: number): void;
  /** Small pacing delay so the in-flight view is legible even when work is instant. */
  pause(minMs?: number, maxMs?: number): Promise<void>;
  saveProject(): void;
}

export type Agent = (ctx: AgentCtx) => Promise<string>; // resolves to a one-line summary

export const AGENT_LABELS: Record<AgentId, string> = {
  intake: "Intake & validation",
  geo: "Geocoding & Census data",
  discovery: "Funding source discovery",
  extraction: "Rule extraction",
  scoring: "Scoring & calculations",
  compliance: "Compliance obligations",
};

export function newTask(agent: AgentId): AgentTask {
  return { id: `${agent}`, agent, label: AGENT_LABELS[agent], status: "queued", progress: 0, steps: [] };
}

export function makeCtx(project: Project, run: Run, task: AgentTask): AgentCtx {
  return {
    project,
    run,
    task,
    step(level, message, detail) {
      task.steps.push({ ts: new Date().toISOString(), level, message, ...(detail ? { detail } : {}) });
      store.saveRun(run);
    },
    progress(pct) {
      task.progress = Math.max(task.progress, Math.min(100, Math.round(pct)));
      store.saveRun(run);
    },
    pause(minMs = 150, maxMs = 600) {
      return new Promise((r) => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
    },
    saveProject() {
      store.saveProject(project);
    },
  };
}

export const usd = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : n >= 1e3 ? `$${Math.round(n / 1e3).toLocaleString()}K` : `$${Math.round(n)}`;
export const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
