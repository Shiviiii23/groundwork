import clsx from "clsx";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  Clock,
  Loader2,
  MinusCircle,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ComplianceStatus, RuleStatus, TaskStatus } from "@shared/types";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("card", className)}>{children}</div>;
}

export function CardHeader({
  title,
  subtitle,
  right,
  icon,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 text-zinc-400">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function Kpi({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  return (
    <Card className="px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        {icon && <span className="text-zinc-400">{icon}</span>}
      </div>
      <div
        className={clsx(
          "tnum mt-2 text-2xl font-semibold tracking-tight",
          tone === "good" && "text-emerald-700",
          tone === "warn" && "text-amber-700",
          tone === "bad" && "text-red-700",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </Card>
  );
}

type PillTone = "neutral" | "good" | "warn" | "bad" | "info" | "accent" | "serious";
const toneClass: Record<PillTone, string> = {
  neutral: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  good: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  serious: "bg-orange-50 text-orange-800 ring-orange-200",
  bad: "bg-red-50 text-red-800 ring-red-200",
  info: "bg-sky-50 text-sky-800 ring-sky-200",
  accent: "bg-indigo-50 text-indigo-700 ring-indigo-200",
};

export function Pill({
  tone = "neutral",
  children,
  icon,
  className,
}: {
  tone?: PillTone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        toneClass[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function RuleStatusPill({ status }: { status: RuleStatus }) {
  const map: Record<RuleStatus, [PillTone, ReactNode, string]> = {
    pass: ["good", <CheckCircle2 key="i" size={12} />, "Pass"],
    partial: ["warn", <MinusCircle key="i" size={12} />, "Partial"],
    fail: ["bad", <XCircle key="i" size={12} />, "Fail"],
    needs_info: ["neutral", <CircleHelp key="i" size={12} />, "Needs info"],
  };
  const [tone, icon, label] = map[status];
  return (
    <Pill tone={tone} icon={icon}>
      {label}
    </Pill>
  );
}

export function ComplianceStatusPill({ status }: { status: ComplianceStatus }) {
  const map: Record<ComplianceStatus, [PillTone, ReactNode, string]> = {
    compliant: ["good", <CheckCircle2 key="i" size={12} />, "Compliant"],
    at_risk: ["warn", <AlertTriangle key="i" size={12} />, "At risk"],
    violation: ["bad", <XCircle key="i" size={12} />, "Violation"],
    pending: ["neutral", <Clock key="i" size={12} />, "Pending"],
  };
  const [tone, icon, label] = map[status];
  return (
    <Pill tone={tone} icon={icon}>
      {label}
    </Pill>
  );
}

export function TaskStatusIcon({ status, size = 16 }: { status: TaskStatus; size?: number }) {
  switch (status) {
    case "running":
      return <Loader2 size={size} className="animate-spin text-indigo-600" />;
    case "done":
      return <CheckCircle2 size={size} className="text-emerald-600" />;
    case "error":
      return <XCircle size={size} className="text-red-600" />;
    case "skipped":
      return <MinusCircle size={size} className="text-zinc-400" />;
    default:
      return <CircleDashed size={size} className="text-zinc-300" />;
  }
}

export function ProgressBar({
  value,
  running,
  className,
  tone = "accent",
}: {
  value: number; // 0-100
  running?: boolean;
  className?: string;
  tone?: "accent" | "good" | "bad" | "warn" | "neutral";
}) {
  const fill =
    tone === "good"
      ? "bg-emerald-500"
      : tone === "bad"
        ? "bg-red-500"
        : tone === "warn"
          ? "bg-amber-400"
          : tone === "neutral"
            ? "bg-zinc-300"
            : "bg-indigo-500";
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-zinc-100", className)}>
      <div
        className={clsx("h-full rounded-full transition-[width] duration-500", running ? "bar-running" : fill)}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/** Small fit-score ring, single hue; value 0-100. */
export function ScoreRing({ value, size = 52 }: { value: number; size?: number }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-label={`Fit score ${Math.round(v)}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f4f4f5" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--viz-series-1)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          style={{ transition: "stroke-dashoffset 600ms ease" }}
        />
      </svg>
      <div className="tnum absolute inset-0 grid place-items-center text-sm font-semibold text-zinc-900">
        {Math.round(v)}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-500">
      <Loader2 size={16} className="animate-spin" /> {label ?? "Loading…"}
    </div>
  );
}

export function PageLoading({ label }: { label?: string }) {
  return (
    <div className="grid h-64 place-items-center">
      <Spinner label={label} />
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <div className="flex items-start gap-2">
        <XCircle size={16} className="mt-0.5 shrink-0" />
        <div>
          <div className="font-medium">Something went wrong</div>
          <div className="text-red-700/90">{msg}</div>
        </div>
      </div>
      {onRetry && (
        <button className="btn-ghost !py-1 text-xs" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white/60 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-zinc-400">{icon}</div>}
      <div className="text-sm font-semibold text-zinc-900">{title}</div>
      {body && <div className="mt-1 max-w-md text-sm text-zinc-500">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="label mb-1">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-zinc-900/30 p-4 pt-16 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className={clsx("card w-full shadow-xl", wide ? "max-w-3xl" : "max-w-xl")}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button className="text-zinc-400 hover:text-zinc-700" onClick={onClose} aria-label="Close">
            <XCircle size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1 block text-xs font-medium text-zinc-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-zinc-400">{hint}</span>}
    </label>
  );
}
