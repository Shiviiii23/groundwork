import fs from "node:fs";
import path from "node:path";

// Minimal .env loader (no dotenv dependency). Existing env vars win.
const envFile = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const val = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

const { default: express } = await import("express");
const { default: cors } = await import("cors");
const { store, newId } = await import("./store");
const { startRun, startDocumentRun } = await import("./orchestrator");
const { llmEnabled, MODEL } = await import("./llm");
const { SAMPLE_PROJECTS } = await import("./data/samples");
const { evaluateCompliance, sampleComplianceData, parseRentRollCsv } = await import("./engine/compliance");

import type { NextFunction, Request, Response } from "express";
import type { ComplianceEvent, DocumentSourceInput, HealthInfo, Project, ProjectInput, ProjectSummary, PursuitStatus, StreamSnapshot, TenantUnit } from "../shared/types";
import { fundingIdentified } from "../shared/funding";
import { library } from "./docs/library";
import { previewDocument } from "./docs/pipeline";

const app = express();
app.use(cors());
// Funding documents arrive as base64 PDFs; QAPs commonly run 5–30 MB.
app.use(express.json({ limit: "60mb" }));

function requireProject(req: Request, res: Response): Project | null {
  const p = store.getProject(req.params.id);
  if (!p) res.status(404).json({ error: "Project not found" });
  return p ?? null;
}

function summarize(p: Project): ProjectSummary {
  const run = store.getRun(p.latestRunId);
  const byId = new Map(p.programs.map((x) => [x.id, x]));
  const total = fundingIdentified(p.programs, p.scores);
  const top = p.scores[0];
  let complianceOverall: ProjectSummary["complianceOverall"];
  if (p.compliance) {
    try {
      complianceOverall = evaluateCompliance(p).overall;
    } catch {
      /* compliance summary is best-effort */
    }
  }
  return {
    id: p.id,
    name: p.input.name,
    city: p.input.city,
    state: p.input.state,
    totalUnits: p.input.unitMix.reduce((s, r) => s + r.count, 0),
    createdAt: p.createdAt,
    runStatus: run?.status,
    topProgram: top ? { name: byId.get(top.programId)?.shortName ?? top.programId, fitScore: top.fitScore } : undefined,
    eligibleCount: p.scores.filter((s) => s.eligible).length,
    programCount: p.programs.length,
    estimatedFundingTotal: total,
    complianceOverall,
  };
}

function validInput(b: Partial<ProjectInput>): string | null {
  if (!b || typeof b !== "object") return "Body must be a ProjectInput";
  for (const k of ["name", "address", "city", "state", "zip"] as const) if (!b[k] || typeof b[k] !== "string") return `Missing ${k}`;
  if (!Array.isArray(b.unitMix) || !b.unitMix.length) return "unitMix must be a non-empty array";
  if (!(Number(b.totalDevelopmentCost) > 0)) return "totalDevelopmentCost must be > 0";
  return null;
}

function complianceResponse(p: Project) {
  if (!p.compliance) {
    p.compliance = sampleComplianceData(p);
    store.saveProject(p);
  }
  return { report: evaluateCompliance(p), data: p.compliance };
}

// ───────────── routes ─────────────

app.get("/api/health", (_req, res) => {
  const body: HealthInfo = { ok: true, llmEnabled: llmEnabled(), censusKey: Boolean(process.env.CENSUS_API_KEY), model: MODEL };
  res.json(body);
});

app.get("/api/samples", (_req, res) => res.json(SAMPLE_PROJECTS));

app.get("/api/projects", (_req, res) => res.json(store.listProjects().map(summarize)));

app.post("/api/projects", (req, res) => {
  const err = validInput(req.body);
  if (err) return res.status(400).json({ error: err });
  const now = new Date().toISOString();
  const project: Project = { id: newId("prj"), createdAt: now, updatedAt: now, input: req.body as ProjectInput, programs: [], scores: [] };
  store.saveProject(project);
  const run = startRun(project);
  res.status(201).json({ project, run });
});

app.get("/api/projects/:id", (req, res) => {
  const p = requireProject(req, res);
  if (p) res.json({ project: p, run: store.getRun(p.latestRunId) });
});

app.delete("/api/projects/:id", (req, res) => {
  if (!requireProject(req, res)) return;
  store.deleteProject(req.params.id);
  res.json({ ok: true });
});

app.post("/api/projects/:id/rerun", (req, res) => {
  const p = requireProject(req, res);
  if (!p) return;
  if (store.getRun(p.latestRunId)?.status === "running") return res.status(409).json({ error: "A run is already in progress" });
  res.json({ run: startRun(p) });
});

app.get("/api/projects/:id/stream", (req, res) => {
  const p = requireProject(req, res);
  if (!p) return;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write("retry: 3000\n\n");

  let closed = false;
  let pending: NodeJS.Timeout | null = null;
  let closeTimer: NodeJS.Timeout | null = null;
  const send = () => {
    pending = null;
    if (closed) return;
    const project = store.getProject(p.id);
    if (!project) return cleanup();
    const run = store.getRun(project.latestRunId);
    const snap: StreamSnapshot = { project, run };
    res.write(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`);
    if (run?.status !== "running" && !closeTimer) {
      closeTimer = setTimeout(() => {
        if (!closed) res.write(`event: done\ndata: ${JSON.stringify({ status: run?.status ?? "none" })}\n\n`);
        cleanup();
      }, 2000);
    }
  };
  const onChange = () => {
    if (!pending) pending = setTimeout(send, 200); // throttle bursts of step updates
  };
  const heartbeat = setInterval(send, 1500);
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    if (pending) clearTimeout(pending);
    if (closeTimer) clearTimeout(closeTimer);
    store.off(`project:${p.id}`, onChange);
    res.end();
  };
  store.on(`project:${p.id}`, onChange);
  req.on("close", cleanup);
  send();
});

/** Validates a DocumentSourceInput body; returns an error message or null. */
function documentError(b: Partial<DocumentSourceInput>): string | null {
  if (!b || typeof b.title !== "string" || !b.title.trim()) return "title is required";
  const sources = [b.text, b.pdfBase64, b.url, b.libraryKey].filter((x) => typeof x === "string" && x.trim());
  if (sources.length !== 1) return "Provide exactly one of text, pdfBase64, url, or libraryKey";
  if (b.libraryKey && !library.latest(b.libraryKey)) return "Unknown rule library source";
  return null;
}

app.post("/api/projects/:id/documents", (req, res) => {
  const p = requireProject(req, res);
  if (!p) return;
  const body = req.body as DocumentSourceInput;
  const err = documentError(body);
  if (err) return res.status(400).json({ error: err });
  if (store.getRun(p.latestRunId)?.status === "running") return res.status(409).json({ error: "A run is already in progress" });
  // Without Claude the pipeline still serves rule-library hits; anything else stops after the free page-selection preview.
  res.json({ run: startDocumentRun(p, body) });
});

app.post("/api/library/preview", async (req, res) => {
  const body = req.body as DocumentSourceInput;
  const err = documentError(body);
  if (err) return res.status(400).json({ error: err });
  try {
    res.json(await previewDocument(body));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.get("/api/library", (_req, res) => res.json(library.list()));

app.get("/api/library/:key", (req, res) => {
  const d = library.detail(req.params.key);
  if (!d) return res.status(404).json({ error: "Not in rule library" });
  res.json(d);
});

app.delete("/api/library/:key", (req, res) => {
  if (!library.remove(req.params.key)) return res.status(404).json({ error: "Not in rule library" });
  res.json({ ok: true });
});

app.patch("/api/projects/:id/programs/:programId", (req, res) => {
  const p = requireProject(req, res);
  if (!p) return;
  const prog = p.programs.find((x) => x.id === req.params.programId);
  if (!prog) return res.status(404).json({ error: "Program not found" });
  const pursuit = req.body?.pursuit as PursuitStatus;
  if (!["considering", "applying", "awarded", "declined"].includes(pursuit)) return res.status(400).json({ error: "Invalid pursuit status" });
  prog.pursuit = pursuit;
  store.saveProject(p);
  res.json({ project: p });
});

app.get("/api/projects/:id/compliance", (req, res) => {
  const p = requireProject(req, res);
  if (p) res.json(complianceResponse(p));
});

app.put("/api/projects/:id/compliance/units", (req, res) => {
  const p = requireProject(req, res);
  if (!p) return;
  let units: TenantUnit[];
  try {
    units = typeof req.body?.csv === "string" ? parseRentRollCsv(req.body.csv) : req.body?.units;
  } catch (err) {
    return res.status(400).json({ error: `Could not parse rent roll: ${(err as Error).message}` });
  }
  if (!Array.isArray(units)) return res.status(400).json({ error: "Provide units[] or csv" });
  const base = p.compliance ?? sampleComplianceData(p);
  p.compliance = { ...base, units, updatedAt: new Date().toISOString() };
  store.saveProject(p);
  res.json(complianceResponse(p));
});

app.post("/api/projects/:id/compliance/sample", (req, res) => {
  const p = requireProject(req, res);
  if (!p) return;
  p.compliance = sampleComplianceData(p);
  store.saveProject(p);
  res.json(complianceResponse(p));
});

app.post("/api/projects/:id/compliance/events", (req, res) => {
  const p = requireProject(req, res);
  if (!p) return;
  const ev = req.body as ComplianceEvent;
  if (!ev?.key || !ev?.completedDate) return res.status(400).json({ error: "key and completedDate are required" });
  const base = p.compliance ?? sampleComplianceData(p);
  p.compliance = { ...base, events: [...base.events, { key: ev.key, completedDate: ev.completedDate, ...(ev.note ? { note: ev.note } : {}) }], updatedAt: new Date().toISOString() };
  store.saveProject(p);
  res.json(complianceResponse(p));
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// Production: serve the built client with SPA fallback.
const dist = path.resolve(process.cwd(), "dist");
if (process.env.NODE_ENV === "production" && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal error" });
});

const port = Number(process.env.PORT) || 8787;
const server = app.listen(port, () => {
  console.log(`Groundwork API on http://localhost:${port} · Claude ${llmEnabled() ? `enabled (${MODEL})` : "disabled (set ANTHROPIC_API_KEY)"}`);
});

const shutdown = () => {
  store.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
