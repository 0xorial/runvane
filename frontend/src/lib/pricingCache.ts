import { getModelCapabilities } from "@/api/client";
import { buildModelPricingByName, type ModelPricing } from "./costEstimation";

let cached: Promise<Map<string, ModelPricing>> | null = null;

export function getPricingMap(): Promise<Map<string, ModelPricing>> {
  if (!cached) {
    cached = getModelCapabilities()
      .then((data) => buildModelPricingByName(data.models))
      .catch((e: unknown) => { throw e; });
  }
  return cached;
}

export function invalidatePricingCache(): void {
  cached = null;
}
