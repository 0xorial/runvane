import type { ProviderCostBreakdown } from "../../../backend/src/contracts/provider-cost";
import type { ModelPricing } from "@/lib/costEstimation";

export type StreamUsageFields = {
  promptTokens?: number;
  cachedPromptTokens?: number;
  completionTokens?: number;
  provider_cost?: number;
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

/** USD for one stream: provider-reported when available, else estimated from pricing. */
export function streamCostUsd(entry: StreamUsageFields, pricing: ModelPricing | undefined): number | null {
  if (typeof entry.provider_cost === "number" && Number.isFinite(entry.provider_cost)) return entry.provider_cost;
  if (!pricing) return null;
  const b = resolveStreamTokenBreakdown(entry);
  return (
    (b.input / 1_000_000) * pricing.inCostPer1m +
    (b.cached / 1_000_000) * pricing.cachedInCostPer1m +
    (b.output / 1_000_000) * pricing.outCostPer1m
  );
}

/** Precise USD label for per-call amounts, trailing zeros trimmed. */
export function formatCostUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.000001) return "<$0.000001";
  if (usd < 0.01) return `$${usd.toFixed(6).replace(/0+$/, "").replace(/\.$/, ".00")}`;
  return `$${usd.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00")}`;
}
