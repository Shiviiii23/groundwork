import { FileUp, Loader2 } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { ErrorBox, Field, Modal } from "./ui";

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
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  async function onFile(file: File) {
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
    setText(await file.text());
  }

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await api.addDocument(projectId, { title, url: url || undefined, text });
      setTitle("");
      setUrl("");
      setText("");
      onStarted();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a funding document" wide>
      <p className="mb-4 text-sm text-zinc-600">
        Paste a QAP, NOFA, or program guideline. The extraction agent turns its requirements into scoreable rules and the scoring agent compares
        them against this project.
        {!llmEnabled && (
          <span className="mt-2 block rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            AI agents are off (no ANTHROPIC_API_KEY on the server), so extraction will be limited.
          </span>
        )}
      </p>
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Title">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="2026 City Housing Trust Fund NOFA" />
          </Field>
          <Field label="Source URL (optional)">
            <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </Field>
        </div>
        <Field label="Document text">
          <textarea
            className="input min-h-[220px] font-mono text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the program requirements, threshold criteria, and scoring sections…"
          />
        </Field>
        <label className="btn-ghost w-fit cursor-pointer text-xs">
          <FileUp size={14} /> Load .txt / .md file
          <input type="file" accept=".txt,.md,.csv,.json" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        {error ? <ErrorBox error={error} /> : null}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!title || text.trim().length < 40 || busy} onClick={submit}>
            {busy && <Loader2 size={14} className="animate-spin" />} Extract & score
          </button>
        </div>
      </div>
    </Modal>
  );
}
