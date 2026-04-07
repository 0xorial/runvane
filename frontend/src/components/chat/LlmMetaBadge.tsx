import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** frontend2/src/components/chat/LLMRequestBadge.tsx — only renders when there is something to show */
export type LlmMetaBadgeProps = {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  showTokenBreakdown?: boolean;
  estimatedCostUsd?: number;
  className?: string;
};

function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return "<0.01";
  if (value < 0 && value > -0.01) return ">-0.01";
  return value.toFixed(2);
}

export function LlmMetaBadge({
  model,
  promptTokens = 0,
  completionTokens = 0,
  durationMs,
  showTokenBreakdown = false,
  estimatedCostUsd,
  className,
}: LlmMetaBadgeProps) {
  const m = String(model ?? "").trim();
  const modelShort = m.includes("/") ? m.split("/").pop() ?? m : m;
  const hasTokens =
    Number.isFinite(promptTokens) &&
    Number.isFinite(completionTokens);
  const totalTokens = hasTokens ? promptTokens + completionTokens : 0;
  const hasDuration = typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0;

  const segments: ReactNode[] = [];
  if (modelShort) segments.push(<span key="model">{modelShort}</span>);
  if (hasTokens) {
    segments.push(
      showTokenBreakdown ? (
        <span key="tok">
          in {promptTokens.toLocaleString()} / out {completionTokens.toLocaleString()} tok
        </span>
      ) : (
        <span key="tok">{totalTokens.toLocaleString()} tok</span>
      ),
    );
  }
  if (hasDuration) segments.push(<span key="s">{(durationMs / 1000).toFixed(1)}s</span>);
  if (estimatedCostUsd != null) {
    segments.push(<span key="usd">${formatUsd(estimatedCostUsd)}</span>);
  }

  if (segments.length === 0) return null;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground",
        className,
      )}
    >
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {i > 0 ? <span className="text-border">•</span> : null}
          {seg}
        </Fragment>
      ))}
    </div>
  );
}
