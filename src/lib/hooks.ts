import { useCallback, useEffect, useRef, useState } from "react";
import type { HealthInfo, Project, Run, StreamSnapshot } from "@shared/types";
import { api } from "../api";

/** Generic async loader with reload. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setData(await fnRef.current());
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload, setData };
}

let healthCache: Promise<HealthInfo> | null = null;
export function useHealth() {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    healthCache ??= api.health();
    healthCache.then(setHealth).catch(() => {
      healthCache = null;
      setDown(true);
    });
  }, []);
  return { health, down };
}

/** Project + run, kept live via SSE while a run is in flight. */
export function useProjectStream(id: string | undefined) {
  const [project, setProject] = useState<Project | undefined>();
  const [run, setRun] = useState<Run | undefined>();
  const [error, setError] = useState<unknown>();
  const [connected, setConnected] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let es: EventSource | null = null;

    api
      .project(id)
      .then(({ project, run }) => {
        if (cancelled) return;
        setProject(project);
        setRun(run);
        setError(undefined);
      })
      .catch((e) => !cancelled && setError(e));

    es = new EventSource(`/api/projects/${id}/stream`);
    es.addEventListener("open", () => setConnected(true));
    es.addEventListener("snapshot", (ev) => {
      try {
        const snap = JSON.parse((ev as MessageEvent).data) as StreamSnapshot;
        setProject(snap.project);
        if (snap.run) setRun(snap.run);
      } catch {
        /* ignore malformed */
      }
    });
    es.addEventListener("error", () => {
      // Server closes the stream after the run completes; stop auto-reconnect.
      setConnected(false);
      es?.close();
    });

    return () => {
      cancelled = true;
      es?.close();
    };
  }, [id, nonce]);

  /** Re-open the stream (e.g. after starting a new run). */
  const resubscribe = useCallback(() => setNonce((n) => n + 1), []);

  return { project, run, error, connected, setProject, setRun, resubscribe };
}

/** Re-render every `ms` while `active` (for elapsed timers). */
export function useTicker(active: boolean, ms = 500) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const h = setInterval(() => setT((t) => t + 1), ms);
    return () => clearInterval(h);
  }, [active, ms]);
}
