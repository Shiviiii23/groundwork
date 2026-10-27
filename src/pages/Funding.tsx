import { Landmark } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Card, Empty, ErrorBox, Kpi, PageHeader, PageLoading, Pill } from "../components/ui";
import { money, PROGRAM_TYPE_LABEL } from "../lib/format";
import { useAsync } from "../lib/hooks";

type Row = {
  projectId: string;
  projectName: string;
  programId: string;
  programName: string;
  type: string;
  jurisdiction: string;
  eligible: boolean;
  fit: number;
  thresholds: string;
  points: string;
  award: number;
  pursuit: string;
};

export default function FundingPage() {
  const { data, error, loading, reload } = useAsync(async () => {
    const list = await api.projects();
    const full = await Promise.all(list.map((p) => api.project(p.id).then((r) => r.project).catch(() => null)));
    const rows: Row[] = [];
    for (const p of full) {
      if (!p) continue;
      for (const s of p.scores) {
        const prog = p.programs.find((x) => x.id === s.programId);
        if (!prog) continue;
        rows.push({
          projectId: p.id,
          projectName: p.input.name,
          programId: prog.id,
          programName: prog.name,
          type: prog.type,
          jurisdiction: prog.jurisdiction,
          eligible: s.eligible,
          fit: s.fitScore,
          thresholds: `${s.thresholdsPassed}/${s.thresholdsTotal}`,
          points: s.pointsPossible ? `${Math.round(s.pointsEarned * 10) / 10}/${s.pointsPossible}` : "n/a",
          award: s.estimatedAward,
          pursuit: prog.pursuit ?? "considering",
        });
      }
    }
    return rows;
  });
  const [onlyEligible, setOnlyEligible] = useState(false);
  const [sort, setSort] = useState<"fit" | "award">("fit");

  const rows = useMemo(() => {
    const r = (data ?? []).filter((x) => !onlyEligible || x.eligible);
    return [...r].sort((a, b) => (sort === "fit" ? b.fit - a.fit : b.award - a.award));
  }, [data, onlyEligible, sort]);

  const all = data ?? [];
  const eligible = all.filter((r) => r.eligible);
  const applying = all.filter((r) => r.pursuit === "applying" || r.pursuit === "awarded");

  return (
    <div>
      <PageHeader eyebrow="Funding" title="All funding matches" subtitle="Every program scored across your portfolio." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Programs scored" value={all.length} />
        <Kpi label="Eligible matches" value={eligible.length} tone="good" />
        <Kpi label="Eligible funding" value={money(eligible.reduce((a, r) => a + r.award, 0))} />
        <Kpi label="Applying / awarded" value={applying.length} hint={money(applying.reduce((a, r) => a + r.award, 0))} />
      </div>

      {loading && !data ? (
        <PageLoading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : all.length === 0 ? (
        <Empty icon={<Landmark size={26} />} title="No scored programs yet" body="Create a project and the agents will find and score funding sources." />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-zinc-100 px-5 py-3 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="accent-indigo-600" checked={onlyEligible} onChange={(e) => setOnlyEligible(e.target.checked)} />
              Eligible only
            </label>
            <span className="text-zinc-300">|</span>
            <span className="text-zinc-500">Sort by</span>
            <select className="rounded-md border border-zinc-200 px-2 py-1" value={sort} onChange={(e) => setSort(e.target.value as "fit" | "award")}>
              <option value="fit">Fit score</option>
              <option value="award">Estimated award</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/60 text-left">
                  <th className="label px-5 py-2.5">Program</th>
                  <th className="label px-3 py-2.5">Project</th>
                  <th className="label px-3 py-2.5">Status</th>
                  <th className="label px-3 py-2.5 text-right">Fit</th>
                  <th className="label px-3 py-2.5 text-right">Thresholds</th>
                  <th className="label px-3 py-2.5 text-right">Points</th>
                  <th className="label px-3 py-2.5 text-right">Est. award</th>
                  <th className="label px-3 py-2.5">Pursuit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.projectId + r.programId} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/70">
                    <td className="px-5 py-3">
                      <Link to={`/projects/${r.projectId}/programs/${r.programId}`} className="font-medium text-zinc-900 hover:text-indigo-700">
                        {r.programName}
                      </Link>
                      <div className="text-xs text-zinc-500">
                        {PROGRAM_TYPE_LABEL[r.type] ?? r.type} · {r.jurisdiction === "federal" ? "Federal" : r.jurisdiction}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Link to={`/projects/${r.projectId}`} className="text-zinc-700 hover:text-indigo-700">
                        {r.projectName}
                      </Link>
                    </td>
                    <td className="px-3 py-3">{r.eligible ? <Pill tone="good">Eligible</Pill> : <Pill tone="bad">Not eligible</Pill>}</td>
                    <td className="tnum px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-14 overflow-hidden rounded-full bg-zinc-100">
                          <div className="h-full rounded-full" style={{ width: `${r.fit}%`, background: "var(--viz-series-1)" }} />
                        </div>
                        <span className="w-6 font-semibold">{Math.round(r.fit)}</span>
                      </div>
                    </td>
                    <td className="tnum px-3 py-3 text-right">{r.thresholds}</td>
                    <td className="tnum px-3 py-3 text-right">{r.points}</td>
                    <td className="tnum px-3 py-3 text-right font-medium">{money(r.award)}</td>
                    <td className="px-3 py-3 capitalize text-zinc-600">{r.pursuit}</td>
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
