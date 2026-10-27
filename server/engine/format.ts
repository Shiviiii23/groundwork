// Human-readable formatting shared by the engine's explanations.

export function usd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${n < 0 ? "-" : ""}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 10_000) return `${n < 0 ? "-" : ""}$${Math.round(abs / 1000).toLocaleString("en-US")}k`;
  return `${n < 0 ? "-" : ""}$${Math.round(abs).toLocaleString("en-US")}`;
}

/** Exact dollars, e.g. "$1,842". */
export function usdExact(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function pct(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function miles(n: number): string {
  return `${n.toFixed(2)} mi`;
}

export function num(n: number, digits = 0): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function yesNo(b: unknown): string {
  return b ? "Yes" : "No";
}
