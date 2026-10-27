export const LIVE_TIMEOUT_MS = 6000;

/** fetch JSON with a hard timeout; throws on non-2xx, network errors, or timeout. */
export async function fetchJson<T = unknown>(url: string, init: RequestInit = {}, timeoutMs = LIVE_TIMEOUT_MS): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { "User-Agent": "groundwork-prototype/0.1", ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return (await res.json()) as T;
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new Error(`timed out after ${timeoutMs / 1000}s (${new URL(url).host})`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function errMsg(err: unknown): string {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  return e.cause?.code ? `${e.message} (${e.cause.code})` : e.message || String(err);
}
