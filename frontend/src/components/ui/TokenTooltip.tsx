import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { formatTokenCount } from "@/utils/formatTokenCount";
import type { ModelPricing } from "@/lib/costEstimation";

function formatCostUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.000001) return "<$0.000001";
  if (usd < 0.01) return `$${usd.toFixed(6).replace(/0+$/, "").replace(/\.$/, ".00")}`;
  return `$${usd.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00")}`;
}

export function TokenTooltip({
  children,
  promptTokens,
  cachedTokens,
  completionTokens,
  pricing,
}: {
  children: ReactNode;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  pricing?: ModelPricing;
}) {
  const cost =
    pricing != null
      ? (promptTokens / 1_000_000) * pricing.inCostPer1m +
        (cachedTokens / 1_000_000) * pricing.cachedInCostPer1m +
        (completionTokens / 1_000_000) * pricing.outCostPer1m
      : null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="font-mono text-[11px]">
        <div className="space-y-0.5">
          <div>input: {formatTokenCount(promptTokens)}</div>
          <div>cached: {formatTokenCount(cachedTokens)}</div>
          <div>output: {formatTokenCount(completionTokens)}</div>
          <div className="mt-1 border-t border-border/40 pt-1">
            {cost !== null ? (
              <>cost: {formatCostUsd(cost)}</>
            ) : (
              <span className="italic text-muted-foreground/60">cost: unknown</span>
            )}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
