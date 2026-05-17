import { useEffect, useState } from "react";
import { getPricingMap } from "@/lib/pricingCache";
import type { ModelPricing } from "@/lib/costEstimation";

export function usePricingMap(): Map<string, ModelPricing> {
  const [map, setMap] = useState<Map<string, ModelPricing>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    void getPricingMap().then((m) => {
      if (!cancelled) setMap(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return map;
}
