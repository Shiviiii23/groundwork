import clsx from "clsx";
import { BookMarked, ChevronDown, ChevronRight, Coins, Database, Library as LibraryIcon, Loader2, PiggyBank, Repeat, Trash2 } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LibrarySource, LibrarySourceDetail, ProjectSummary } from "@shared/types";
import { api } from "../api";
import { CacheBadge, PageStrip } from "../components/PipelineCard";
import { Card, CardHeader, Empty, ErrorBox, Kpi, PageHeader, PageLoading, Pill } from "../components/ui";
import { num, pageRanges, relTime, shortDate, usd } from "../lib/format";

export default function LibraryPage() {
  const [sources, setSources] = useState<LibrarySource[]>();
  const [error, setError] = useState<unknown>();
  const [openKey, setOpenKey] = useState<string>();

  const load = useCallback(() => {
    setError(undefined);
    api.library().then(setSources, setError);
  }, []);
  useEffect(load, [load]);

  if (error && !sources) return <ErrorBox error={error} onRetry={load} />;
  if (!sources) return <PageLoading label="Loading rule library…" />;

  const rulesCached = sources.reduce((a, s) => a + (s.versions[0]?.ruleCount ?? 0) + (s.versions[0]?.complianceCount ?? 0), 0);
  const spend = sources.reduce((a, s) => a + s.totalCostUsd, 0);
  const saved = sources.reduce((a, s) => a + s.savedUsd, 0);
  const hits = sources.reduce((a, s) => a + s.hits, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Extraction cache"
        title="Rule library"
        subtitle="Rules extracted from funding documents, cached per funding source. Re-using a document costs nothing; a new edition only re-reads the sections that changed."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Sources cached" value={num(sources.length)} icon={<LibraryIcon size={16} />} />
        <Kpi label="Rules cached" value={num(rulesCached)} hint="Latest editions, incl. compliance" icon={<BookMarked size={16} />} />
        <Kpi label="AI spend" value={usd(spend)} hint="All extractions" icon={<Coins size={16} />} />
        <Kpi label="Est. saved" value={usd(saved)} tone={saved > 0 ? "good" : "default"} hint="Page filtering + cache hits" icon={<PiggyBank size={16} />} />
        <Kpi label="Cache hits" value={num(hits)} hint="Documents served without AI" icon={<Repeat size={16} />} />
      </div>

      {sources.length === 0 ? (
        <Empty
          icon={<Database size={28} />}
          title="The rule library is empty"
          body="Add a funding document (QAP, NOFA, guidelines) to any project and its extracted rules are cached here automatically. The next project that needs the same source gets them instantly."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left">
                  {["", "Source", "Versions", "Latest edition", "Pages used", "Rules", "Hits", "Spend", "Saved", "Last used"].map((h, i) => (
                    <th key={i} className={clsx("label px-4 py-3 !text-[10.5px]", i >= 4 && "text-right")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => {
                  const v = s.versions[0];
                  const open = openKey === s.sourceKey;
                  return (
                    <Fragment key={s.sourceKey}>
                      <tr
                        className={clsx("cursor-pointer border-b border-zinc-100 transition", open ? "bg-indigo-50/30" : "hover:bg-zinc-50")}
                        onClick={() => setOpenKey(open ? undefined : s.sourceKey)}
                      >
                        <td className="w-8 pl-4 text-zinc-400">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-zinc-900">{s.name}</div>
                          <div className="text-xs text-zinc-500">{s.administrator ?? s.url ?? s.sourceKey}</div>
                        </td>
                        <td className="tnum px-4 py-3 text-zinc-700">{s.versions.length}</td>
                        <td className="px-4 py-3">
                          <div className="text-zinc-800">{v?.title ?? "—"}</div>
                          <div className="text-xs text-zinc-500">{v ? shortDate(v.extractedAt) : ""}</div>
                        </td>
                        <td className="tnum px-4 py-3 text-right text-zinc-700">{v ? `${v.relevantPages.length} / ${v.pageCount}` : "—"}</td>
                        <td className="tnum px-4 py-3 text-right text-zinc-700">{v ? v.ruleCount + v.complianceCount : "—"}</td>
                        <td className="tnum px-4 py-3 text-right text-zinc-700">{s.hits}</td>
                        <td className="tnum px-4 py-3 text-right text-zinc-700">{usd(s.totalCostUsd)}</td>
                        <td className="tnum px-4 py-3 text-right font-medium text-emerald-700">{usd(s.savedUsd)}</td>
                        <td className="px-4 py-3 text-right text-xs text-zinc-500">{relTime(s.lastUsedAt)}</td>
                      </tr>
                      {open && (
                        <tr className="border-b border-zinc-100 bg-zinc-50/40">
                          <td colSpan={10} className="px-6 py-5">
                            <SourceDetail
                              sourceKey={s.sourceKey}
                              onDeleted={() => {
                                setOpenKey(undefined);
                                load();
                              }}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function SourceDetail({ sourceKey, onDeleted }: { sourceKey: string; onDeleted: () => void }) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<LibrarySourceDetail>();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState<"apply" | "delete">();
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    api.librarySource(sourceKey).then(setDetail, setError);
    api.projects().then((p) => {
      setProjects(p);
      if (p[0]) setProjectId(p[0].id);
    }, () => undefined);
  }, [sourceKey]);

  async function apply() {
    if (!detail || !projectId) return;
    setBusy("apply");
    setError(undefined);
    try {
      await api.addDocument(projectId, { title: detail.source.name, libraryKey: sourceKey });
      navigate(`/projects/${projectId}`);
    } catch (e) {
      setError(e);
      setBusy(undefined);
    }
  }

  async function invalidate() {
    if (!detail || !window.confirm(`Delete cached rules for "${detail.source.name}"? The next upload will be extracted from scratch.`)) return;
    setBusy("delete");
    try {
      await api.deleteLibrarySource(sourceKey);
      onDeleted();
    } catch (e) {
      setError(e);
      setBusy(undefined);
    }
  }

  if (!detail) return error ? <ErrorBox error={error} /> : <div className="text-sm text-zinc-400">Loading…</div>;

  const thresholds = detail.rules.filter((r) => r.kind === "threshold");
  const points = detail.rules.filter((r) => r.kind === "points");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl text-sm text-zinc-700">
          <div className="font-medium text-zinc-900">{detail.program.name}</div>
          <p className="mt-1 leading-relaxed text-zinc-600">{detail.program.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input !w-56 !py-1.5 text-xs" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!projects.length}>
            {projects.length ? projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>) : <option>No projects yet</option>}
          </select>
          <button className="btn-primary !py-1.5 text-xs" disabled={!projectId || !!busy} onClick={apply}>
            {busy === "apply" && <Loader2 size={13} className="animate-spin" />} Use in project
          </button>
          <button className="btn-ghost !py-1.5 text-xs text-red-700" disabled={!!busy} onClick={invalidate}>
            {busy === "delete" ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Invalidate cache
          </button>
        </div>
      </div>
      {error ? <ErrorBox error={error} /> : null}

      <div>
        <div className="label mb-2">Version history</div>
        <div className="space-y-2">
          {detail.source.versions.map((v) => (
            <div key={v.docHash} className="grid items-center gap-4 rounded-lg border border-zinc-200 bg-white px-4 py-3 md:grid-cols-[220px_1fr_200px]">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-zinc-900">{v.title}</div>
                <div className="tnum text-[11px] text-zinc-500">
                  {shortDate(v.extractedAt)} · <span className="font-mono">{v.docHash.slice(0, 10)}</span>
                </div>
              </div>
              <div className="min-w-0">
                <PageStrip pageCount={v.pageCount} relevantPages={v.relevantPages} sections={v.stats.sections} height={16} labels={false} />
                <div className="tnum mt-0.5 truncate text-[10.5px] text-zinc-500">
                  Read pp. {pageRanges(v.relevantPages) || "—"}
                </div>
              </div>
              <div className="flex flex-col items-start gap-1 md:items-end">
                <CacheBadge hit={v.stats.cacheHit} />
                <span className="tnum text-[11px] text-zinc-600">
                  {usd(v.stats.costUsd)} · {v.ruleCount} rule{v.ruleCount === 1 ? "" : "s"} · {v.complianceCount} obligation{v.complianceCount === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Eligibility & scoring rules" subtitle={`${thresholds.length} thresholds · ${points.length} scoring criteria (${points.reduce((a, r) => a + (r.maxPoints ?? 0), 0)} pts)`} />
          <ul className="max-h-96 divide-y divide-zinc-100 overflow-y-auto">
            {[...thresholds, ...points].map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-5 py-2.5">
                <Pill tone={r.kind === "threshold" ? "neutral" : "accent"}>{r.kind === "threshold" ? "Threshold" : `${r.maxPoints ?? 0} pts`}</Pill>
                <div className="min-w-0">
                  <div className="text-sm text-zinc-900">{r.title}</div>
                  <div className="text-[11px] text-zinc-500">{r.citation}</div>
                </div>
              </li>
            ))}
            {!detail.rules.length && <li className="px-5 py-4 text-sm text-zinc-400">No scoreable rules.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Compliance obligations" subtitle={`${detail.complianceRules.length} post-award requirement${detail.complianceRules.length === 1 ? "" : "s"}`} />
          <ul className="max-h-96 divide-y divide-zinc-100 overflow-y-auto">
            {detail.complianceRules.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-5 py-2.5">
                <Pill tone="neutral">{c.frequency}</Pill>
                <div className="min-w-0">
                  <div className="text-sm text-zinc-900">{c.title}</div>
                  <div className="text-[11px] text-zinc-500">{c.citation}</div>
                </div>
              </li>
            ))}
            {!detail.complianceRules.length && <li className="px-5 py-4 text-sm text-zinc-400">None extracted.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
