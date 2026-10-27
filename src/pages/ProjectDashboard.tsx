import { FilePlus2, Landmark, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { PursuitStatus } from "@shared/types";
import { fundingIdentified } from "@shared/funding";
import { api } from "../api";
import AddDocumentModal from "../components/AddDocumentModal";
import AgentsPanel from "../components/AgentsPanel";
import GeoPanel from "../components/GeoPanel";
import { FitChart, ProgramCard, rankPrograms } from "../components/Scoreboard";
import { Card, Empty, ErrorBox, Kpi, PageHeader, PageLoading, Pill } from "../components/ui";
import { money, num, pct } from "../lib/format";
import { useHealth, useProjectStream } from "../lib/hooks";

const CONSTRUCTION: Record<string, string> = {
  new_construction: "New construction",
  acq_rehab: "Acquisition / rehab",
  adaptive_reuse: "Adaptive reuse",
};
const POP: Record<string, string> = {
  family: "Family",
  senior: "Senior",
  supportive: "Supportive",
  special_needs: "Special needs",
};

export default function ProjectDashboard() {
  const { id } = useParams<{ id: string }>();
  const { project, run, error, setProject, resubscribe } = useProjectStream(id);
  const { health } = useHealth();
  const [docOpen, setDocOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "eligible">("all");

  const ranked = useMemo(() => (project ? rankPrograms(project.programs, project.scores) : []), [project]);
  const shown = filter === "eligible" ? ranked.filter((r) => r.score?.eligible) : ranked;

  if (error && !project) return <ErrorBox error={error} />;
  if (!project) return <PageLoading label="Loading project…" />;

  const input = project.input;
  const d = project.derived;
  const totalUnits = d?.totalUnits ?? input.unitMix.reduce((a, r) => a + r.count, 0);
  const eligible = project.scores.filter((s) => s.eligible);
  const fundingTotal = fundingIdentified(project.programs, project.scores);
  const running = run?.status === "running";

  async function onPursuit(programId: string, pursuit: PursuitStatus) {
    if (!id) return;
    // optimistic
    setProject((p) => p && { ...p, programs: p.programs.map((x) => (x.id === programId ? { ...x, pursuit } : x)) });
    try {
      const { project: next } = await api.setPursuit(id, programId, pursuit);
      setProject(next);
    } catch {
      /* snapshot will reconcile */
    }
  }

  async function rerun() {
    if (!id) return;
    await api.rerun(id);
    resubscribe();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link to="/projects" className="hover:text-zinc-700">
            Projects
          </Link>
        }
        title={input.name}
        subtitle={`${input.address}, ${input.city}, ${input.state} ${input.zip}`}
        right={
          <>
            <button className="btn-ghost" onClick={() => setDocOpen(true)}>
              <FilePlus2 size={15} /> Add funding document
            </button>
            <Link to={`/compliance/${project.id}`} className="btn-ghost">
              <ShieldCheck size={15} /> Compliance
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap gap-1.5">
        <Pill>{CONSTRUCTION[input.constructionType]}</Pill>
        <Pill>{POP[input.targetPopulation]}</Pill>
        <Pill>{num(totalUnits)} units</Pill>
        <Pill>{input.affordabilityPeriodYears}-yr affordability</Pill>
        {input.nonprofitSponsor && <Pill>Nonprofit sponsor</Pill>}
        {input.siteControl && <Pill tone="good">Site control</Pill>}
        {input.zoningApproved && <Pill tone="good">Zoned</Pill>}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi label="Total dev. cost" value={money(input.totalDevelopmentCost)} hint={d ? `${money(d.costPerUnit)} / unit` : undefined} />
        <Kpi label="Units ≤60% AMI" value={d ? pct(d.pctUnitsAt60) : "—"} hint={d ? `${pct(d.pctUnitsAt30)} at ≤30% AMI` : undefined} />
        <Kpi
          label="Adj. eligible basis"
          value={d ? money(d.adjustedEligibleBasis) : "—"}
          hint={d ? (d.basisBoostEligible ? "130% QCT/DDA boost applied" : "No basis boost") : undefined}
        />
        <Kpi label="Eligible programs" value={`${eligible.length}/${project.programs.length || "—"}`} tone={eligible.length ? "good" : "default"} />
        <Kpi label="Funding identified" value={money(fundingTotal)} hint="Eligible awards · best tax credit only, excl. loan insurance" />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <AgentsPanel run={run} onRerun={rerun} />
        </div>
        <div className="xl:col-span-3">
          <GeoPanel geo={project.geo} pending={running} />
        </div>
      </div>

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Funding scoreboard</h2>
            <p className="text-sm text-zinc-500">Ranked by eligibility, then fit. Open a program for the rule-by-rule comparison.</p>
          </div>
          <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5 text-xs">
            {(["all", "eligible"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`rounded-md px-3 py-1.5 font-medium capitalize ${filter === k ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-900"}`}
              >
                {k === "all" ? `All (${ranked.length})` : `Eligible (${eligible.length})`}
              </button>
            ))}
          </div>
        </div>

        {ranked.length === 0 ? (
          running ? (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Card key={i} className="h-56 animate-pulse bg-zinc-50/80">
                  <span />
                </Card>
              ))}
            </div>
          ) : (
            <Empty icon={<Landmark size={26} />} title="No funding programs found" body="Try re-running the agents or adding a funding document." />
          )
        ) : (
          <div className="space-y-6">
            <FitChart items={shown} />
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {shown.map((item) => (
                <ProgramCard key={item.program.id} projectId={project.id} item={item} rank={ranked.indexOf(item) + 1} onPursuit={onPursuit} />
              ))}
            </div>
          </div>
        )}
      </section>

      <AddDocumentModal
        projectId={project.id}
        open={docOpen}
        onClose={() => setDocOpen(false)}
        onStarted={resubscribe}
        llmEnabled={health?.llmEnabled}
      />
    </div>
  );
}
