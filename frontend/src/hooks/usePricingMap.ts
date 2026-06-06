import { usePricingMapQuery } from "./queries/referenceData";
import type { ModelPricing } from "@/lib/costEstimation";

export function usePricingMap(): Map<string, ModelPricing> {
  const { pricingByModel } = usePricingMapQuery();
  return pricingByModel;
}
