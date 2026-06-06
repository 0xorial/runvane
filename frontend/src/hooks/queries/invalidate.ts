import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
import type { ModelPresetResponse } from "../../../../backend/src/contracts/model-presets";
import type { LlmProviderRow } from "../../../../backend/src/contracts/settings";
import { queryClient } from "@/lib/queryClient";
import { getAgents, getLlmSettings, getModelPresets } from "../../api/client";
import { queryKeys } from "./keys";

export function invalidateAgents(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.agents });
}

export function refreshAgents(): Promise<AgentListItemResponse[]> {
  return queryClient.fetchQuery({ queryKey: queryKeys.agents, queryFn: getAgents });
}

export function invalidateModelCapabilities(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.modelCapabilities });
}

export function invalidateModelPresets(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.modelPresets });
}

export function refreshModelPresets(): Promise<ModelPresetResponse[]> {
  return queryClient.fetchQuery({ queryKey: queryKeys.modelPresets, queryFn: getModelPresets });
}

export function invalidateLlmProviders(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.llmProviders });
}

export function refreshLlmProviders(): Promise<LlmProviderRow[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.llmProviders,
    queryFn: async () => (await getLlmSettings()).providers,
  });
}
