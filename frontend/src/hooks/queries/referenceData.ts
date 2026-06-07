import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
import type { ModelPresetResponse } from "../../../../backend/src/contracts/model-presets";
import type { LlmProviderRow } from "../../../../backend/src/contracts/settings";
import { getAgents, getLlmSettings, getModelCapabilities, getModelPresets } from "../../api/client";
import { buildModelPricingByName, type ModelPricing } from "@/lib/costEstimation";
import { queryKeys } from "./keys";

export function useAgentsQuery() {
  return useQuery({
    queryKey: queryKeys.agents,
    queryFn: getAgents,
  });
}

export function useModelCapabilitiesQuery() {
  return useQuery({
    queryKey: queryKeys.modelCapabilities,
    queryFn: getModelCapabilities,
  });
}

const EMPTY_PRICING_BY_MODEL = new Map<string, ModelPricing>();

export function usePricingMapQuery(): { pricingByModel: Map<string, ModelPricing>; isLoading: boolean } {
  const query = useModelCapabilitiesQuery();
  const pricingByModel = useMemo(
    () => (query.data ? buildModelPricingByName(query.data.models) : EMPTY_PRICING_BY_MODEL),
    [query.data],
  );
  return { pricingByModel, isLoading: query.isLoading };
}

export function useModelPresetsQuery() {
  return useQuery({
    queryKey: queryKeys.modelPresets,
    queryFn: getModelPresets,
  });
}

export function useLlmProvidersQuery() {
  return useQuery({
    queryKey: queryKeys.llmProviders,
    queryFn: async (): Promise<LlmProviderRow[]> => {
      const data = await getLlmSettings();
      return data.providers;
    },
  });
}

/** Agents list for UI that treats `null` as still loading. */
export function useAgentsList(): AgentListItemResponse[] | null {
  const { data, isPending } = useAgentsQuery();
  if (isPending && data === undefined) return null;
  return data ?? [];
}

export function useModelPresetsList(): ModelPresetResponse[] | null {
  const { data, isPending } = useModelPresetsQuery();
  if (isPending && data === undefined) return null;
  return data ?? [];
}
