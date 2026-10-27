import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Card, ComplianceStatusPill, Empty, ErrorBox, Kpi, PageHeader, PageLoading, Pill } from "../components/ui";
import { num } from "../lib/format";
import { useAsync } from "../lib/hooks";

export default function ComplianceListPage() {
  const { data, error, loading, reload } = useAsync(() => api.projects());
  const projects = data ?? [];
  const count = (s: string) => projects.filter((p) => p.complianceOverall === s).length;

  return (
    <div>
      <PageHeader
        eyebrow="Compliance"
        title="Compliance portfolio"
        subtitle="Post-award obligations from each awarded program, matched against your rent rolls and filings."
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Projects" value={num(projects.length)} />
        <Kpi label="Compliant" value={count("compliant")} tone="good" />
        <Kpi label="At risk" value={count("at_risk")} tone={count("at_risk") ? "warn" : "default"} />
        <Kpi label="In violation" value={count("violation")} tone={count("violation") ? "bad" : "default"} />
      </div>
      {loading && !data ? (
        <PageLoading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : projects.length === 0 ? (
        <Empty icon={<ShieldCheck size={26} />} title="No projects" body="Create a project first; compliance tracking starts once a program is marked awarded." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} to={`/compliance/${p.id}`} className="group">
              <Card className="h-full p-5 transition group-hover:border-zinc-300 group-hover:shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-zinc-900">{p.name}</div>
                    <div className="text-xs text-zinc-500">
                      {p.city}, {p.state} · {num(p.totalUnits)} units
                    </div>
                  </div>
                  <ArrowUpRight size={16} className="text-zinc-300 group-hover:text-indigo-600" />
                </div>
                <div className="mt-4 flex items-center gap-2">
                  {p.complianceOverall ? <ComplianceStatusPill status={p.complianceOverall} /> : <Pill>Not started</Pill>}
                  <span className="text-xs text-zinc-500">{p.eligibleCount} eligible programs</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
