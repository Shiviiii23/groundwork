import clsx from "clsx";
import { ArrowRight, BookMarked, ClipboardPaste, Database, Eye, FileUp, Globe, Loader2, Zap } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { DocumentSourceInput, LibrarySource, PipelineStats } from "@shared/types";
import { api } from "../api";
import { bytes, shortDate, usd } from "../lib/format";
import { PageStrip } from "./PipelineCard";
import { ErrorBox, Field, Modal, Pill } from "./ui";

type Tab = "pdf" | "text" | "url" | "library";

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "pdf", label: "Upload PDF", icon: <FileUp size={14} /> },
  { id: "text", label: "Paste text", icon: <ClipboardPaste size={14} /> },
  { id: "url", label: "From URL", icon: <Globe size={14} /> },
  { id: "library", label: "From rule library", icon: <BookMarked size={14} /> },
];

/** Reads a File as base64 without the data: URL prefix. */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error ?? new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

function Funnel({ stats }: { stats: PipelineStats }) {
  const estRelevant = stats.relevantPages.length;
  const steps: [string, number][] = [
    ["Pages", stats.pageCount],
    ["Kept by keyword pass", stats.keywordKept],
    ["Sent to triage", stats.triaged],
    ["Est. relevant", estRelevant],
  ];
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="label">Page selection preview</span>
        {stats.cacheHit === "full" && (
          <Pill tone="good" icon={<Database size={11} />}>
            Already in library — will reuse cached rules
          </Pill>
        )}
        {stats.cacheHit === "partial" && (
          <Pill tone="info" icon={<Database size={11} />}>
            Earlier edition in library — unchanged sections reused
          </Pill>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {steps.map(([label, n], i) => (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && <ArrowRight size={13} className="text-zinc-300" />}
            <div className={clsx("rounded-md px-2.5 py-1.5", i === steps.length - 1 ? "bg-indigo-50 ring-1 ring-inset ring-indigo-200" : "bg-white ring-1 ring-inset ring-zinc-200")}>
              <div className={clsx("tnum text-sm font-semibold", i === steps.length - 1 ? "text-indigo-700" : "text-zinc-900")}>{n}</div>
              <div className="text-[10px] text-zinc-500">{label}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <PageStrip pageCount={stats.pageCount} relevantPages={stats.relevantPages} sections={stats.sections} height={20} labels={false} />
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-zinc-600">
        <Zap size={12} className="text-indigo-500" />
        {stats.cacheHit === "full" ? (
          <span>No AI cost — rules come straight from the library.</span>
        ) : (
          <span className="tnum">
            Est. cost ~{usd(stats.costUsd)} vs ~{usd(stats.fullReadCostUsdEst)} reading the whole document
          </span>
        )}
      </div>
    </div>
  );
}

export default function AddDocumentModal({
  projectId,
  open,
  onClose,
  onStarted,
  llmEnabled,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onStarted: () => void;
  llmEnabled?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("pdf");
  const [sourceName, setSourceName] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [pdf, setPdf] = useState<{ name: string; size: number; base64: string }>();
  const [libraryKey, setLibraryKey] = useState<string>();
  const [library, setLibrary] = useState<LibrarySource[]>();
  const [preview, setPreview] = useState<PipelineStats>();
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  useEffect(() => {
    if (!open) return;
    api.library().then(setLibrary, () => setLibrary([]));
  }, [open]);

  // Any change to the document invalidates an earlier preview.
  useEffect(() => setPreview(undefined), [tab, text, url, pdf, sourceName]);

  function reset() {
    setSourceName("");
    setTitle("");
    setUrl("");
    setText("");
    setPdf(undefined);
    setLibraryKey(undefined);
    setPreview(undefined);
    setError(undefined);
  }

  async function onPdf(file: File) {
    setError(undefined);
    try {
      const base64 = await readBase64(file);
      setPdf({ name: file.name, size: file.size, base64 });
      const base = file.name.replace(/\.[^.]+$/, "");
      if (!title) setTitle(base);
      if (!sourceName) setSourceName(base);
    } catch (e) {
      setError(e);
    }
  }

  function buildInput(): DocumentSourceInput | null {
    if (tab === "library") {
      const src = library?.find((s) => s.sourceKey === libraryKey);
      return src ? { title: title || src.name, libraryKey: src.sourceKey } : null;
    }
    const base = { title: title.trim(), sourceName: sourceName.trim() || undefined, url: url.trim() || undefined };
    if (!base.title) return null;
    if (tab === "pdf") return pdf ? { ...base, pdfBase64: pdf.base64 } : null;
    if (tab === "text") return text.trim().length >= 40 ? { ...base, text } : null;
    return base.url ? base : null;
  }

  const input = buildInput();

  async function runPreview() {
    if (!input) return;
    setPreviewing(true);
    setError(undefined);
    try {
      setPreview(await api.previewDocument(input));
    } catch (e) {
      setError(e);
    } finally {
      setPreviewing(false);
    }
  }

  async function submit() {
    if (!input) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.addDocument(projectId, input);
      reset();
      onStarted();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const names = [...new Set((library ?? []).map((s) => s.name))];

  return (
    <Modal open={open} onClose={onClose} title="Add a funding document" wide>
      <p className="mb-4 text-sm text-zinc-600">
        Add a QAP, NOFA, or program guideline. Agents find the pages that hold rules, extract only those, and save the result to the rule library so
        the same document is never read twice.
      </p>
      {!llmEnabled && (
        <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          AI agents are off (no ANTHROPIC_API_KEY on the server). You can preview page selection and reuse documents already in the rule library;
          new documents can't be extracted.
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition",
              tab === t.id ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200" : "text-zinc-600 hover:text-zinc-900",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {tab === "library" ? (
          <LibraryPicker library={library} selected={libraryKey} onSelect={setLibraryKey} />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Funding source name" hint="Use the same name for every edition of a program so cached rules are reused.">
                <input
                  className="input"
                  list="library-sources"
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  placeholder="CA TCAC 9% QAP"
                />
                <datalist id="library-sources">
                  {names.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </Field>
              <Field label="Title" hint="This edition, e.g. the year.">
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="2026 QAP (adopted Dec 2025)" />
              </Field>
            </div>

            {tab === "pdf" && (
              <label
                className={clsx(
                  "flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center transition",
                  pdf ? "border-indigo-300 bg-indigo-50/40" : "border-zinc-300 bg-zinc-50/60 hover:border-indigo-300",
                )}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) void onPdf(f);
                }}
              >
                <FileUp size={20} className="mb-2 text-zinc-400" />
                {pdf ? (
                  <>
                    <span className="text-sm font-medium text-zinc-900">{pdf.name}</span>
                    <span className="tnum text-xs text-zinc-500">{bytes(pdf.size)} · click to replace</span>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-medium text-zinc-700">Drop a PDF here or click to choose</span>
                    <span className="text-xs text-zinc-500">QAPs and NOFAs of any length</span>
                  </>
                )}
                <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => e.target.files?.[0] && onPdf(e.target.files[0])} />
              </label>
            )}

            {tab === "text" && (
              <Field label="Document text">
                <textarea
                  className="input min-h-[200px] font-mono text-xs"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste the full document — the agents will find the sections that matter…"
                />
              </Field>
            )}

            <Field label={tab === "url" ? "Document URL" : "Source URL (optional)"} hint={tab === "url" ? "Link to the PDF or program page." : undefined}>
              <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </Field>

            {preview && <Funnel stats={preview} />}
          </>
        )}

        {error ? <ErrorBox error={error} /> : null}

        <div className="flex items-center justify-between gap-2">
          <div>
            {tab !== "library" && (
              <button className="btn-ghost text-xs" disabled={!input || previewing} onClick={runPreview}>
                {previewing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview page selection
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" disabled={!input || busy} onClick={submit}>
              {busy && <Loader2 size={14} className="animate-spin" />}
              {tab === "library" ? "Apply cached rules" : "Extract & score"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function LibraryPicker({
  library,
  selected,
  onSelect,
}: {
  library?: LibrarySource[];
  selected?: string;
  onSelect: (key: string) => void;
}) {
  if (!library) return <div className="py-6 text-center text-sm text-zinc-400">Loading rule library…</div>;
  if (!library.length)
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/60 px-4 py-8 text-center text-sm text-zinc-500">
        The rule library is empty. Documents you add to any project are cached here automatically.
      </div>
    );
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <Pill tone="good" icon={<Zap size={11} />}>
          Instant · no AI cost
        </Pill>
      </div>
      <ul className="max-h-80 divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200">
        {library.map((s) => {
          const v = s.versions[0];
          return (
            <li key={s.sourceKey}>
              <label className={clsx("flex cursor-pointer items-center gap-3 px-4 py-3 transition", selected === s.sourceKey ? "bg-indigo-50/60" : "hover:bg-zinc-50")}>
                <input type="radio" name="library-source" className="accent-indigo-600" checked={selected === s.sourceKey} onChange={() => onSelect(s.sourceKey)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-zinc-900">{s.name}</div>
                  <div className="truncate text-xs text-zinc-500">
                    {v ? `${v.title} · extracted ${shortDate(v.extractedAt)}` : "No versions"}
                    {s.administrator ? ` · ${s.administrator}` : ""}
                  </div>
                </div>
                {v && (
                  <span className="tnum shrink-0 text-xs text-zinc-600">
                    {v.ruleCount} rules · {v.complianceCount} obligations
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
