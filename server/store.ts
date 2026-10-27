import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { Project, Run } from "../shared/types";

const DATA_DIR = path.resolve(process.cwd(), "server/.data");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const RUNS_FILE = path.join(DATA_DIR, "runs.json");

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

class Store extends EventEmitter {
  private projects = new Map<string, Project>();
  private runs = new Map<string, Run>();
  private writeTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.setMaxListeners(200);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    for (const p of readJson<Project[]>(PROJECTS_FILE, [])) this.projects.set(p.id, p);
    for (const r of readJson<Run[]>(RUNS_FILE, [])) this.runs.set(r.id, r);
    // Runs interrupted by a restart can never finish; mark them so the UI doesn't spin forever.
    for (const r of this.runs.values()) {
      if (r.status !== "running") continue;
      r.status = "error";
      r.finishedAt = new Date().toISOString();
      for (const t of r.tasks) {
        if (t.status === "running" || t.status === "queued") {
          t.status = "error";
          t.steps.push({ ts: r.finishedAt, level: "error", message: "Interrupted by server restart" });
        }
      }
    }
    this.scheduleWrite();
  }

  listProjects(): Project[] {
    return [...this.projects.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getProject(id: string): Project | undefined {
    return this.projects.get(id);
  }

  saveProject(p: Project): void {
    p.updatedAt = new Date().toISOString();
    this.projects.set(p.id, p);
    this.scheduleWrite();
    this.emit(`project:${p.id}`);
  }

  deleteProject(id: string): void {
    this.projects.delete(id);
    for (const r of [...this.runs.values()]) if (r.projectId === id) this.runs.delete(r.id);
    this.scheduleWrite();
  }

  getRun(id: string | undefined): Run | undefined {
    return id ? this.runs.get(id) : undefined;
  }

  saveRun(r: Run): void {
    this.runs.set(r.id, r);
    this.scheduleWrite();
    this.emit(`project:${r.projectId}`);
  }

  private scheduleWrite(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.flush();
    }, 400);
  }

  flush(): void {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify([...this.projects.values()], null, 1));
    fs.writeFileSync(RUNS_FILE, JSON.stringify([...this.runs.values()], null, 1));
  }
}

export const store = new Store();

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
