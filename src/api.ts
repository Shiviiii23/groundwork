import type {
  ComplianceData,
  ComplianceEvent,
  ComplianceReport,
  DocumentSourceInput,
  HealthInfo,
  LibrarySource,
  LibrarySourceDetail,
  PipelineStats,
  Project,
  ProjectInput,
  ProjectSummary,
  PursuitStatus,
  Run,
  SampleProject,
  TenantUnit,
} from "@shared/types";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

const json = (body: unknown) => JSON.stringify(body);

export type ComplianceBundle = { report: ComplianceReport; data: ComplianceData };

export const api = {
  health: () => req<HealthInfo>("/health"),
  samples: () => req<SampleProject[]>("/samples"),
  projects: () => req<ProjectSummary[]>("/projects"),
  project: (id: string) => req<{ project: Project; run?: Run }>(`/projects/${id}`),
  createProject: (input: ProjectInput) =>
    req<{ project: Project; run: Run }>("/projects", { method: "POST", body: json(input) }),
  deleteProject: (id: string) => req<{ ok: true }>(`/projects/${id}`, { method: "DELETE" }),
  rerun: (id: string) => req<{ run: Run }>(`/projects/${id}/rerun`, { method: "POST" }),
  addDocument: (id: string, doc: DocumentSourceInput) =>
    req<{ run: Run }>(`/projects/${id}/documents`, { method: "POST", body: json(doc) }),
  previewDocument: (doc: DocumentSourceInput) => req<PipelineStats>("/library/preview", { method: "POST", body: json(doc) }),
  library: () => req<LibrarySource[]>("/library"),
  librarySource: (key: string) => req<LibrarySourceDetail>(`/library/${encodeURIComponent(key)}`),
  deleteLibrarySource: (key: string) => req<{ ok: true }>(`/library/${encodeURIComponent(key)}`, { method: "DELETE" }),
  setPursuit: (id: string, programId: string, pursuit: PursuitStatus) =>
    req<{ project: Project }>(`/projects/${id}/programs/${programId}`, {
      method: "PATCH",
      body: json({ pursuit }),
    }),
  compliance: (id: string) => req<ComplianceBundle>(`/projects/${id}/compliance`),
  putUnits: (id: string, body: { units?: TenantUnit[]; csv?: string }) =>
    req<ComplianceBundle>(`/projects/${id}/compliance/units`, { method: "PUT", body: json(body) }),
  sampleCompliance: (id: string) =>
    req<ComplianceBundle>(`/projects/${id}/compliance/sample`, { method: "POST" }),
  addEvent: (id: string, ev: ComplianceEvent) =>
    req<ComplianceBundle>(`/projects/${id}/compliance/events`, { method: "POST", body: json(ev) }),
};
