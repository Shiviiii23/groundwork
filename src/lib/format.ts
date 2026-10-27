export function money(n: number | undefined | null, opts: { full?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (opts.full) return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function pct(n: number | undefined | null, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function num(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

export function shortDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function relTime(iso?: string): string {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function elapsed(start?: string, end?: string): string {
  if (!start) return "";
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const s = Math.max(0, ms / 1000);
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function daysUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
}

export const AGENT_LABEL: Record<string, string> = {
  intake: "Intake",
  geo: "Geo & Census",
  discovery: "Funding discovery",
  extraction: "Rule extraction",
  scoring: "Scoring",
  compliance: "Compliance",
};

export const PROGRAM_TYPE_LABEL: Record<string, string> = {
  federal_tax_credit: "Federal tax credit",
  federal_grant: "Federal grant",
  federal_loan: "Federal loan",
  state_program: "State program",
  local_program: "Local program",
  private: "Private",
};

/** Money with cents for small amounts (AI spend), compact otherwise. */
export function usd(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) < 100) return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
  return money(n);
}

/** Compact token counts: 412300 → "412K". */
export function tokens(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(n));
}

/** Collapses page numbers to ranges: [1,2,3,7,9,10] → "1–3, 7, 9–10". */
export function pageRanges(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    out.push(start === sorted[i] ? `${start}` : `${start}–${sorted[i]}`);
  }
  return out.join(", ");
}

export function bytes(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}
