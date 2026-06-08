import { z } from 'zod';
import type { LlmUsage } from '../llmProviders/types.js';

export const ProviderCostBreakdownSchema = z.object({
  input: z.number(),
  output: z.number(),
  cached: z.number(),
});
export type ProviderCostBreakdown = z.infer<typeof ProviderCostBreakdownSchema>;

export function providerCostBreakdownFromUsage(
  usage: Pick<LlmUsage, 'promptTokens' | 'completionTokens' | 'cachedPromptTokens'>,
): ProviderCostBreakdown {
  const cached = Math.max(0, usage.cachedPromptTokens ?? 0);
  const input = Math.max(0, usage.promptTokens - cached);
  return { input, output: usage.completionTokens, cached };
}

export function providerCostEntryFieldsFromUsage(usage: LlmUsage): {
  provider_cost?: number;
  provider_cost_breakdown: ProviderCostBreakdown;
} {
  return {
    provider_cost_breakdown: providerCostBreakdownFromUsage(usage),
    ...(typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd)
      ? { provider_cost: usage.costUsd }
      : {}),
  };
}
