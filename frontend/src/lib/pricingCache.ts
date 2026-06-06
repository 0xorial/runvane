import { getModelCapabilities, invalidateModelCapabilitiesCache } from "@/api/client";
import { buildModelPricingByName, type ModelPricing } from "./costEstimation";

let cached: Promise<Map<string, ModelPricing>> | null = null;

export function getPricingMap(): Promise<Map<string, ModelPricing>> {
  if (!cached) {
    cached = getModelCapabilities()
      .then((data) => buildModelPricingByName(data.models))
      .catch((e: unknown) => {
        cached = null;
        throw e;
      });
  }
  return cached;
}

export function invalidatePricingCache(): void {
  cached = null;
  invalidateModelCapabilitiesCache();
}
