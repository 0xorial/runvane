import { createQuery } from "@tanstack/svelte-query";
import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";
import type { ModelPresetResponse } from "../../../../backend/src/contracts/model-presets";
import type { LlmProviderRow } from "../../../../backend/src/contracts/settings";
import { getAgents, getLlmSettings, getModelCapabilities, getModelPresets } from "@/api/client";
import { buildModelPricingByName, type ModelPricing } from "@/lib/costEstimation";
import { queryKeys } from "./keys";

const EMPTY_PRICING = new Map<string, ModelPricing>();

export function createAgentsQuery() {
  return createQuery(() => ({
    queryKey: queryKeys.agents,
    queryFn: getAgents,
  }));
}

export function createModelCapabilitiesQuery() {
  return createQuery(() => ({
    queryKey: queryKeys.modelCapabilities,
    queryFn: getModelCapabilities,
  }));
}

export function createModelPresetsQuery() {
  return createQuery(() => ({
    queryKey: queryKeys.modelPresets,
    queryFn: getModelPresets,
  }));
}

export function createLlmProvidersQuery() {
  return createQuery(() => ({
    queryKey: queryKeys.llmProviders,
    queryFn: async (): Promise<LlmProviderRow[]> => {
      const data = await getLlmSettings();
      return data.providers;
    },
  }));
}

export function pricingFromCapabilities(
  data: Awaited<ReturnType<typeof getModelCapabilities>> | undefined,
): Map<string, ModelPricing> {
  return data ? buildModelPricingByName(data.models) : EMPTY_PRICING;
}

export type AgentsList = AgentListItemResponse[] | null;
export type PresetsList = ModelPresetResponse[] | null;
