import clsx from "clsx";
import { Bot, ChevronDown, ChevronRight, Compass, FileSearch, Gauge, MapPin, ShieldCheck, ClipboardCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AgentId, AgentStep, AgentTask, Run } from "@shared/types";
import { elapsed } from "../lib/format";
import { useTicker } from "../lib/hooks";
import { Card, Pill, ProgressBar, TaskStatusIcon } from "./ui";

const AGENT_ICON: Record<AgentId, ReactNode> = {
  intake: <ClipboardCheck size={15} />,
  geo: <MapPin size={15} />,
  discovery: <Compass size={15} />,
  extraction: <FileSearch size={15} />,
  scoring: <Gauge size={15} />,
  compliance: <ShieldCheck size={15} />,
};

const levelClass: Record<AgentStep["level"], string> = {
  info: "text-zinc-600",
  tool: "text-indigo-700",
  result: "text-emerald-700",
  warn: "text-amber-700",
  error: "text-red-700",
};

const levelTag: Record<AgentStep["level"], string> = {
  info: "info",
  tool: "tool",
  result: "done",
  warn: "warn",
  error: "err",
};

function StepLog({ steps }: { steps: AgentStep[] }) {
  return (
    <ol className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-zinc-100 bg-zinc-50/70 p-3">
      {steps.map((s, i) => (
        <li key={i} className="grid grid-cols-[64px_40px_1fr] gap-2 text-xs">
          <span className="tnum font-mono text-[10.5px] text-zinc-400">
            {new Date(s.ts).toLocaleTimeString("en-US", { hour12: false })}
          </span>
          <span className={clsx("font-mono text-[10.5px] uppercase", levelClass[s.level])}>{levelTag[s.level]}</span>
          <div className="min-w-0">
            <div className={clsx(levelClass[s.level], s.level === "info" && "text-zinc-700")}>{s.message}</div>
            {s.detail && (
              <div className="mt-0.5 break-all font-mono text-[10.5px] leading-relaxed text-zinc-500">{s.detail}</div>
            )}
          </div>
        </li>
      ))}
      {steps.length === 0 && <li className="text-xs text-zinc-400">Waiting to start…</li>}
    </ol>
  );
}

function TaskRow({ task, defaultOpen }: { task: AgentTask; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setOpen(defaultOpen);
  }, [defaultOpen, touched]);
  const latest = task.steps[task.steps.length - 1];
  const running = task.status === "running";

  return (
    <div className={clsx("rounded-xl border transition", running ? "border-indigo-200 bg-indigo-50/30" : "border-zinc-200/80 bg-white")}>
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={() => {
          setTouched(true);
          setOpen((o) => !o);
        }}
      >
        <TaskStatusIcon status={task.status} />
        <span className={clsx("grid h-7 w-7 shrink-0 place-items-center rounded-lg", running ? "bg-indigo-100 text-indigo-700" : "bg-zinc-100 text-zinc-500")}>
          {AGENT_ICON[task.agent] ?? <Bot size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-zinc-900">{task.label}</span>
            {running && <span className="live-dot shrink-0" />}
          </div>
          <div className="truncate text-xs text-zinc-500">
            {task.status === "done" || task.status === "error" ? task.summary ?? latest?.message : latest?.message ?? "Queued"}
          </div>
          <ProgressBar
            className="mt-2 !h-1"
            value={task.status === "done" ? 100 : task.progress}
            running={running}
            tone={task.status === "error" ? "bad" : task.status === "done" ? "good" : task.status === "queued" ? "neutral" : "accent"}
          />
        </div>
        <span className="tnum w-14 shrink-0 text-right text-xs text-zinc-500">
          {task.startedAt ? elapsed(task.startedAt, task.finishedAt) : "—"}
        </span>
        <span className="text-zinc-400">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <StepLog steps={task.steps} />
        </div>
      )}
    </div>
  );
}

export default function AgentsPanel({ run, onRerun }: { run?: Run; onRerun?: () => void }) {
  const running = run?.status === "running";
  useTicker(running);

  if (!run) {
    return (
      <Card className="p-5">
        <div className="text-sm text-zinc-500">No agent run yet.</div>
      </Card>
    );
  }

  const done = run.tasks.filter((t) => t.status === "done" || t.status === "skipped").length;
  const overall = run.tasks.length ? run.tasks.reduce((a, t) => a + (t.status === "done" || t.status === "skipped" ? 100 : t.progress), 0) / run.tasks.length : 0;
  const toolCalls = run.tasks.reduce((a, t) => a + t.steps.filter((s) => s.level === "tool").length, 0);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4">
        <div className="flex items-center gap-3">
          {running ? <span className="live-dot" /> : <TaskStatusIcon status={run.status === "error" ? "error" : "done"} />}
          <div>
            <div className="text-sm font-semibold">{running ? "In flight" : run.status === "error" ? "Run failed" : "Run complete"}</div>
            <div className="tnum text-xs text-zinc-500">
              {done}/{run.tasks.length} agents · {toolCalls} tool calls · {elapsed(run.startedAt, run.finishedAt)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={run.llmEnabled ? "accent" : "neutral"}>{run.llmEnabled ? "Claude search + extraction" : "Knowledge-base mode"}</Pill>
          {onRerun && !running && (
            <button className="btn-ghost !py-1.5 text-xs" onClick={onRerun}>
              Re-run agents
            </button>
          )}
        </div>
      </div>
      <div className="px-5 pt-4">
        <ProgressBar value={run.status === "running" ? overall : 100} running={running} tone={run.status === "error" ? "bad" : running ? "accent" : "good"} />
      </div>
      <div className="space-y-2 p-5">
        {run.tasks.map((t) => (
          <TaskRow key={t.id} task={t} defaultOpen={t.status === "running"} />
        ))}
      </div>
    </Card>
  );
}
