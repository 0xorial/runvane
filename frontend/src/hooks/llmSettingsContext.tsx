import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LlmProviderRow } from "../../../backend/src/contracts/settings";
import { getLlmSettings } from "../api/client";
import { buildModelGroups, type ModelGroup } from "../pages/settings/helpers";

type LoadStatus = "idle" | "loading" | "ready" | "error";

export type LlmSettingsContextValue = {
  providers: LlmProviderRow[];
  modelGroups: ModelGroup[];
  status: LoadStatus;
  error: Error | null;
  refresh: () => Promise<void>;
};

const LlmSettingsContext = createContext<LlmSettingsContextValue | null>(null);

export function LlmSettingsProvider({ children }: { children: ReactNode }) {
  const [providers, setProviders] = useState<LlmProviderRow[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const inflightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (inflightRef.current) return inflightRef.current;
    setStatus("loading");
    setError(null);
    const p = (async () => {
      try {
        const data = await getLlmSettings();
        setProviders(data.providers);
        setStatus("ready");
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        setStatus("error");
        throw err;
      } finally {
        inflightRef.current = null;
      }
    })();
    inflightRef.current = p;
    return p;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const modelGroups = useMemo(() => buildModelGroups(providers), [providers]);
  const value = useMemo(
    () => ({ providers, modelGroups, status, error, refresh }),
    [providers, modelGroups, status, error, refresh],
  );

  return <LlmSettingsContext.Provider value={value}>{children}</LlmSettingsContext.Provider>;
}

export function useLlmSettings(): LlmSettingsContextValue {
  const ctx = useContext(LlmSettingsContext);
  if (!ctx) throw new Error("useLlmSettings must be used inside <LlmSettingsProvider>");
  return ctx;
}
