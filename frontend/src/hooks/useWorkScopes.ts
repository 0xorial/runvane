import { useEffect, useState } from "react";
import { getWorkMonitor } from "../api/client";
import type { GetWorkMonitorResponse } from "../../../backend/src/contracts/work";

/** Polls `/api/work` while `enabled` — lifecycle scopes (layer 1), not user tasks. */
export function useWorkScopes(enabled: boolean): {
  data: GetWorkMonitorResponse | null;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<GetWorkMonitorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const next = await getWorkMonitor();
        if (!cancelled) {
          setData(next);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const id = setInterval(() => void load(), 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);

  return { data, loading, error };
}
