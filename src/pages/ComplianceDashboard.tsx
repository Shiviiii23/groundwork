import clsx from "clsx";
import { ArrowLeft, CalendarClock, Check, FileSpreadsheet, Info, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ComplianceCategory, ComplianceFinding, ComplianceStatus, Project, UnitComplianceRow } from "@shared/types";
import { api, type ComplianceBundle } from "../api";
import { Card, CardHeader, ComplianceStatusPill, ErrorBox, Kpi, Modal, PageHeader, PageLoading, Pill } from "../components/ui";
import { daysUntil, money, pct, shortDate } from "../lib/format";
import { useAsync } from "../lib/hooks";

const CATEGORY_LABEL: Record<ComplianceCategory, string> = {
  income: "Income eligibility",
  rent: "Rent limits",
  set_aside: "Set-asides",
  occupancy: "Occupancy",
  reporting: "Reporting & filings",
  physical: "Physical inspections",
  affordability_term: "Affordability term",
};

const STATUS_ORDER: Record<ComplianceStatus, number> = { violation: 0, at_risk: 1, pending: 2, compliant: 3 };

function metricText(m: NonNullable<ComplianceFinding["metric"]>) {
  const f = (v: number) => (m.unit === "%" ? pct(v, 1) : m.unit === "$" ? money(v) : m.unit === "days" ? `${v}d` : String(v));
  return `${m.label}: ${f(m.value)} (threshold ${f(m.threshold)})`;
}

function FindingRow({ f, programName }: { f: ComplianceFinding; programName: string }) {
  return (
    <li className="flex items-start gap-4 px-5 py-3.5">
      <div className="pt-0.5">
        <ComplianceStatusPill status={f.status} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-zinc-900">{f.title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-zinc-600">{f.detail}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
          <span>{programName}</span>
          <span>·</span>
          <span>{f.citation}</span>
          {f.metric && <span className="tnum rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-700">{metricText(f.metric)}</span>}
          {f.affectedUnits.length > 0 && (
            <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">
              Units {f.affectedUnits.slice(0, 6).join(", ")}
              {f.affectedUnits.length > 6 ? ` +${f.affectedUnits.length - 6}` : ""}
            </span>
          )}
          {f.dueDate && <span className="rounded bg-zinc-100 px-1.5 py-0.5">Due {shortDate(f.dueDate)}</span>}
        </div>
      </div>
    </li>
  );
}

function PctOfLimitBar({ value }: { value: number }) {
  // value = income / limit; >1 over limit, >1.4 triggers next-available-unit rule
  const w = Math.min(value / 1.6, 1) * 100;
  const color = value > 1.4 ? "var(--status-critical)" : value > 1 ? "var(--status-warning)" : "var(--viz-series-1)";
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-zinc-100">
        <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
        <div className="absolute inset-y-0 w-px bg-zinc-400" style={{ left: `${(1 / 1.6) * 100}%` }} title="100% of limit" />
      </div>
      <span className={clsx("tnum w-10 text-right text-xs", value > 1 ? "font-semibold text-red-700" : "text-zinc-600")}>{pct(value)}</span>
    </div>
  );
}

function UnitGrid({ rows, bundle }: { rows: UnitComplianceRow[]; bundle: ComplianceBundle }) {
  const [only, setOnly] = useState(false);
  const unitsById = new Map(bundle.data.units.map((u) => [u.unitId, u]));
  const shown = only ? rows.filter((r) => r.status !== "compliant") : rows;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Rent roll"
        subtitle={`${rows.length} units · income & rent tested against limits for each unit's designated AMI tier`}
        icon={<FileSpreadsheet size={16} />}
        right={
          <label className="flex items-center gap-2 text-xs text-zinc-600">
            <input type="checkbox" className="accent-indigo-600" checked={only} onChange={(e) => setOnly(e.target.checked)} />
            Issues only
          </label>
        }
      />
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-50">
            <tr className="border-b border-zinc-100 text-left">
              <th className="label px-5 py-2.5">Unit</th>
              <th className="label px-3 py-2.5">Status</th>
              <th className="label px-3 py-2.5">Tier</th>
              <th className="label px-3 py-2.5 text-right">HH</th>
              <th className="label px-3 py-2.5">Income vs limit</th>
              <th className="label px-3 py-2.5 text-right">Gross rent / limit</th>
              <th className="label px-3 py-2.5">Last cert</th>
              <th className="label px-3 py-2.5">Issues</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const u = unitsById.get(r.unitId);
              const overRent = r.grossRent > r.rentLimit;
              return (
                <tr key={r.unitId} className={clsx("border-b border-zinc-100 last:border-0", r.status === "violation" && "bg-red-50/30")}>
                  <td className="px-5 py-2.5 font-medium">
                    {r.unitId}
                    <span className="ml-1.5 text-xs font-normal text-zinc-400">{u ? (u.bedrooms === 0 ? "Studio" : `${u.bedrooms}BR`) : ""}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <ComplianceStatusPill status={r.status} />
                  </td>
                  <td className="tnum px-3 py-2.5 text-xs text-zinc-600">{u ? `${u.designatedAmiPct}%` : "—"}</td>
                  <td className="tnum px-3 py-2.5 text-right text-xs">{u?.isVacant ? <span className="text-zinc-400">vacant</span> : u?.householdSize}</td>
                  <td className="px-3 py-2.5">{u?.isVacant ? <span className="text-xs text-zinc-400">—</span> : <PctOfLimitBar value={r.incomePctOfLimit} />}</td>
                  <td className={clsx("tnum px-3 py-2.5 text-right text-xs", overRent ? "font-semibold text-red-700" : "text-zinc-700")}>
                    {money(r.grossRent, { full: true })} <span className="font-normal text-zinc-400">/ {money(r.rentLimit, { full: true })}</span>
                  </td>
                  <td className="tnum px-3 py-2.5 text-xs text-zinc-600">{u ? shortDate(u.lastCertDate) : "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-zinc-600">{r.issues.length ? r.issues.join("; ") : <span className="text-zinc-300">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RentRollModal({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (csv: string) => Promise<void> }) {
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();
  return (
    <Modal open={open} onClose={onClose} title="Upload rent roll" wide>
      <p className="mb-3 text-sm text-zinc-600">Paste CSV or load a file. Expected header:</p>
      <pre className="mb-3 overflow-x-auto rounded-lg bg-zinc-50 p-3 font-mono text-[11px] text-zinc-700 ring-1 ring-inset ring-zinc-100">
        unitId,bedrooms,designatedAmiPct,isVacant,householdSize,annualIncomeAtMoveIn,currentAnnualIncome,rentCharged,utilityAllowance,moveInDate,lastCertDate,allFullTimeStudents
      </pre>
      <textarea className="input min-h-[200px] font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} />
      <div className="mt-3 flex items-center justify-between">
        <label className="btn-ghost cursor-pointer text-xs">
          <Upload size={14} /> Load .csv
          <input type="file" accept=".csv,.txt" className="hidden" onChange={async (e) => e.target.files?.[0] && setCsv(await e.target.files[0].text())} />
        </label>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={!csv.trim() || busy}
            onClick={async () => {
              setBusy(true);
              setErr(undefined);
              try {
                await onSubmit(csv);
                setCsv("");
                onClose();
              } catch (e) {
                setErr(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Upload & re-check
          </button>
        </div>
      </div>
      {err ? <div className="mt-3"><ErrorBox error={err} /></div> : null}
    </Modal>
  );
}

export default function ComplianceDashboard() {
  const { id } = useParams<{ id: string }>();
  const projectQ = useAsync(() => api.project(id!).then((r) => r.project), [id]);
  const compQ = useAsync(() => api.compliance(id!), [id]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const project: Project | undefined = projectQ.data;
  const bundle = compQ.data;
  const report = bundle?.report;

  const programName = (pid: string) => project?.programs.find((p) => p.id === pid)?.shortName ?? project?.programs.find((p) => p.id === pid)?.name ?? pid;

  const grouped = useMemo(() => {
    const m = new Map<ComplianceCategory, ComplianceFinding[]>();
    for (const f of report?.findings ?? []) {
      if (!m.has(f.category)) m.set(f.category, []);
      m.get(f.category)!.push(f);
    }
    for (const list of m.values()) list.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    return [...m.entries()].sort(
      (a, b) => Math.min(...a[1].map((f) => STATUS_ORDER[f.status])) - Math.min(...b[1].map((f) => STATUS_ORDER[f.status])),
    );
  }, [report]);

  async function act(fn: () => Promise<ComplianceBundle>) {
    setBusy(true);
    try {
      compQ.setData(await fn());
    } finally {
      setBusy(false);
    }
  }

  if (compQ.error) return <ErrorBox error={compQ.error} onRetry={compQ.reload} />;
  if (!report || !bundle) return <PageLoading label="Evaluating compliance…" />;

  const unitsInViolation = report.units.filter((u) => u.status === "violation").length;
  const upcoming = [...report.upcoming].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const awarded = project?.programs.filter((p) => p.pursuit === "awarded") ?? [];
  const trackedNames = report.programIds.map(programName);
  const statusCounts = (["compliant", "at_risk", "violation", "pending"] as ComplianceStatus[]).map((s) => [s, report.findings.filter((f) => f.status === s).length] as const);

  return (
    <div className="space-y-6">
      <Link to="/compliance" className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-800">
        <ArrowLeft size={13} /> Compliance portfolio
      </Link>
      <PageHeader
        eyebrow="Compliance"
        title={project?.input.name ?? "Project"}
        subtitle={`Placed in service ${shortDate(bundle.data.placedInServiceDate)} · rent roll updated ${shortDate(bundle.data.updatedAt)}`}
        right={
          <>
            <button className="btn-ghost" disabled={busy} onClick={() => act(() => api.sampleCompliance(id!))}>
              <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Regenerate sample
            </button>
            <button className="btn-primary" onClick={() => setUploadOpen(true)}>
              <Upload size={14} /> Upload rent roll
            </button>
          </>
        }
      />

      <div className="flex items-start gap-2 rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3 text-sm text-indigo-900">
        <Info size={16} className="mt-0.5 shrink-0" />
        <div>
          Tracking <span className="font-medium">{trackedNames.join(", ") || "no programs"}</span>.{" "}
          {awarded.length === 0 ? (
            <>
              No program is marked <em>awarded</em> yet, so this view falls back to programs you're applying to. Set pursuit status on the{" "}
              <Link to={`/projects/${id}`} className="underline">
                funding scoreboard
              </Link>
              .
            </>
          ) : (
            "Compliance tracks programs marked awarded."
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="px-5 py-4">
          <div className="label">Overall status</div>
          <div className="mt-2.5">
            <ComplianceStatusPill status={report.overall} />
          </div>
          <div className="mt-2 flex gap-2 text-[11px] text-zinc-500">
            {statusCounts.map(([s, n]) => (
              <span key={s} className="tnum">
                {n} {s.replace("_", " ")}
              </span>
            ))}
          </div>
        </Card>
        <Kpi label="Compliance score" value={pct(report.scorePct)} hint="Share of checks compliant" tone={report.scorePct >= 0.9 ? "good" : report.scorePct >= 0.7 ? "warn" : "bad"} />
        <Kpi label="Units in violation" value={unitsInViolation} hint={`of ${report.units.length} units`} tone={unitsInViolation ? "bad" : "good"} />
        <Kpi label="Upcoming deadlines" value={upcoming.length} hint={upcoming[0] ? `Next: ${shortDate(upcoming[0].dueDate)}` : "None scheduled"} icon={<CalendarClock size={16} />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Findings" subtitle="Each program's compliance rules checked against your rent roll and filings" icon={<ShieldCheck size={16} />} />
          {grouped.length === 0 ? (
            <div className="p-5 text-sm text-zinc-500">No compliance rules for the tracked programs.</div>
          ) : (
            grouped.map(([cat, list]) => (
              <div key={cat} className="border-t border-zinc-100 first:border-t-0">
                <div className="flex items-center justify-between bg-zinc-50/60 px-5 py-2">
                  <span className="label">{CATEGORY_LABEL[cat] ?? cat}</span>
                  <span className="tnum text-[11px] text-zinc-500">
                    {list.filter((f) => f.status === "compliant").length}/{list.length} compliant
                  </span>
                </div>
                <ul className="divide-y divide-zinc-100">
                  {list.map((f) => (
                    <FindingRow key={f.ruleId + f.programId} f={f} programName={programName(f.programId)} />
                  ))}
                </ul>
              </div>
            ))
          )}
        </Card>

        <Card>
          <CardHeader title="Upcoming deadlines" icon={<CalendarClock size={16} />} />
          {upcoming.length === 0 ? (
            <div className="p-5 text-sm text-zinc-500">Nothing due.</div>
          ) : (
            <ol className="relative px-5 py-4">
              <div className="absolute bottom-6 left-[29px] top-6 w-px bg-zinc-200" />
              {upcoming.map((u) => {
                const days = daysUntil(u.dueDate);
                const overdue = days < 0;
                const soon = days >= 0 && days <= 30;
                const rule = project?.programs.flatMap((p) => p.complianceRules).find((r) => r.id === u.ruleId);
                const key = String(rule?.check.params?.key ?? u.ruleId);
                return (
                  <li key={u.ruleId + u.dueDate} className="relative flex gap-3 pb-4 last:pb-0">
                    <span
                      className={clsx(
                        "relative z-10 mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-white",
                        overdue ? "bg-red-500" : soon ? "bg-amber-400" : "bg-zinc-300",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-zinc-900">{u.title}</div>
                      <div className="tnum text-xs text-zinc-500">
                        {shortDate(u.dueDate)} · {programName(u.programId)}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        {overdue ? (
                          <Pill tone="bad">{-days}d overdue</Pill>
                        ) : soon ? (
                          <Pill tone="warn">in {days}d</Pill>
                        ) : (
                          <Pill>in {days}d</Pill>
                        )}
                        <button
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 hover:text-indigo-900 disabled:opacity-50"
                          disabled={busy}
                          onClick={() => act(() => api.addEvent(id!, { key, completedDate: new Date().toISOString().slice(0, 10) }))}
                        >
                          <Check size={12} /> Mark complete
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>

      <UnitGrid rows={[...report.units].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.unitId.localeCompare(b.unitId, undefined, { numeric: true }))} bundle={bundle} />

      <RentRollModal open={uploadOpen} onClose={() => setUploadOpen(false)} onSubmit={async (csv) => compQ.setData(await api.putUnits(id!, { csv }))} />
    </div>
  );
}
