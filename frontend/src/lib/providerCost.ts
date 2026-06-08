import type { ProviderCostBreakdown } from "../../../backend/src/contracts/provider-cost";

export type StreamUsageFields = {
  promptTokens?: number;
  cachedPromptTokens?: number;
  completionTokens?: number;
  provider_cost_breakdown?: ProviderCostBreakdown;
};

export function resolveStreamTokenBreakdown(entry: StreamUsageFields): ProviderCostBreakdown {
  if (entry.provider_cost_breakdown) return entry.provider_cost_breakdown;
  const cached = entry.cachedPromptTokens ?? 0;
  const prompt = entry.promptTokens ?? 0;
  return {
    input: Math.max(0, prompt - cached),
    cached,
    output: entry.completionTokens ?? 0,
  };
}

export function streamTotalTokens(entry: StreamUsageFields): number {
  const b = resolveStreamTokenBreakdown(entry);
  return b.input + b.cached + b.output;
}
