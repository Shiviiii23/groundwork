import { Building, FolderKanban, Landmark, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Card, ComplianceStatusPill, Empty, ErrorBox, Kpi, PageHeader, PageLoading, Pill } from "../components/ui";
import { money, num, relTime } from "../lib/format";
import { useAsync } from "../lib/hooks";

export default function ProjectsPage() {
  const { data, error, loading, reload } = useAsync(() => api.projects());
  const nav = useNavigate();

  const projects = data ?? [];
  const eligible = projects.reduce((a, p) => a + p.eligibleCount, 0);
  const funding = projects.reduce((a, p) => a + p.estimatedFundingTotal, 0);
  const issues = projects.filter((p) => p.complianceOverall === "violation" || p.complianceOverall === "at_risk").length;

  return (
    <div>
      <PageHeader
        eyebrow="Portfolio"
        title="Projects"
        subtitle="Every site you're financing — funding fit, agent runs, and compliance at a glance."
        right={
          <Link to="/projects/new" className="btn-primary">
            <Plus size={16} /> New project
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Projects" value={num(projects.length)} icon={<FolderKanban size={16} />} />
        <Kpi label="Eligible programs" value={num(eligible)} hint="Across all projects" icon={<Landmark size={16} />} />
        <Kpi label="Funding identified" value={money(funding)} hint="Estimated, eligible programs" icon={<Building size={16} />} />
        <Kpi
          label="Compliance issues"
          value={num(issues)}
          hint="Projects at risk or in violation"
          tone={issues > 0 ? "warn" : "default"}
          icon={<ShieldAlert size={16} />}
        />
      </div>

      {loading && !data ? (
        <PageLoading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : projects.length === 0 ? (
        <Empty
          icon={<FolderKanban size={28} />}
          title="No projects yet"
          body="Start with a site. Groundwork's agents geocode it, pull Census data, find funding sources, and score your project against each program's rules."
          action={
            <Link to="/projects/new" className="btn-primary">
              <Plus size={16} /> Create your first project
            </Link>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/60 text-left">
                  <th className="label px-5 py-3 font-semibold">Project</th>
                  <th className="label px-3 py-3 text-right">Units</th>
                  <th className="label px-3 py-3">Agents</th>
                  <th className="label px-3 py-3">Top program</th>
                  <th className="label px-3 py-3 text-right">Eligible</th>
                  <th className="label px-3 py-3 text-right">Est. funding</th>
                  <th className="label px-3 py-3">Compliance</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr
                    key={p.id}
                    className="group cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50/70"
                    onClick={() => nav(`/projects/${p.id}`)}
                  >
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-zinc-900">{p.name}</div>
                      <div className="text-xs text-zinc-500">
                        {p.city}, {p.state} · created {relTime(p.createdAt)}
                      </div>
                    </td>
                    <td className="tnum px-3 py-3.5 text-right">{num(p.totalUnits)}</td>
                    <td className="px-3 py-3.5">
                      {p.runStatus === "running" ? (
                        <Pill tone="accent" icon={<span className="live-dot !h-1.5 !w-1.5" />}>
                          In flight
                        </Pill>
                      ) : p.runStatus === "error" ? (
                        <Pill tone="bad">Error</Pill>
                      ) : p.runStatus === "complete" ? (
                        <Pill tone="good">Complete</Pill>
                      ) : (
                        <Pill>—</Pill>
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      {p.topProgram ? (
                        <div className="flex items-center gap-2">
                          <span className="truncate">{p.topProgram.name}</span>
                          <span className="tnum text-xs text-zinc-500">{Math.round(p.topProgram.fitScore)}</span>
                        </div>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="tnum px-3 py-3.5 text-right">
                      {p.eligibleCount}
                      <span className="text-zinc-400">/{p.programCount}</span>
                    </td>
                    <td className="tnum px-3 py-3.5 text-right font-medium">{money(p.estimatedFundingTotal)}</td>
                    <td className="px-3 py-3.5">
                      {p.complianceOverall ? <ComplianceStatusPill status={p.complianceOverall} /> : <span className="text-zinc-400">—</span>}
                    </td>
                    <td className="px-3 py-3.5 text-right">
                      <button
                        className="rounded p-1 text-zinc-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                        title="Delete project"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm(`Delete ${p.name}?`)) return;
                          await api.deleteProject(p.id);
                          reload();
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
