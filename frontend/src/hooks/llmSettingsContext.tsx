import { useCallback, useMemo } from "react";
import type { LlmProviderRow } from "../../../backend/src/contracts/settings";
import { queryClient } from "@/lib/queryClient";
import { buildModelGroups, type ModelGroup } from "../pages/settings/helpers";
import { queryKeys } from "./queries/keys";
import { useLlmProvidersQuery } from "./queries/referenceData";

type LoadStatus = "idle" | "loading" | "ready" | "error";

export type LlmSettingsContextValue = {
  providers: LlmProviderRow[];
  modelGroups: ModelGroup[];
  status: LoadStatus;
  error: Error | null;
  refresh: () => Promise<void>;
  setProviders: (providers: LlmProviderRow[]) => void;
};

export function useLlmSettings(): LlmSettingsContextValue {
  const query = useLlmProvidersQuery();

  const status: LoadStatus = query.isPending
    ? "loading"
    : query.isError
      ? "error"
      : query.isSuccess
        ? "ready"
        : "idle";

  const modelGroups = useMemo(() => buildModelGroups(query.data ?? []), [query.data]);

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);

  const setProviders = useCallback((providers: LlmProviderRow[]) => {
    queryClient.setQueryData(queryKeys.llmProviders, providers);
  }, []);

  return {
    providers: query.data ?? [],
    modelGroups,
    status,
    error: query.error instanceof Error ? query.error : query.error ? new Error(String(query.error)) : null,
    refresh,
    setProviders,
  };
}
