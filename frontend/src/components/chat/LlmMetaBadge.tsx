import { Fragment, type ReactNode } from "react";
import { Zap } from "lucide-react";

/** frontend2/src/components/chat/LLMRequestBadge.tsx — only renders when there is something to show */
export type LlmMetaBadgeProps = {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
};

export function LlmMetaBadge({
  model,
  promptTokens = 0,
  completionTokens = 0,
  durationMs,
}: LlmMetaBadgeProps) {
  const m = String(model ?? "").trim();
  const modelShort = m.includes("/") ? m.split("/").pop() ?? m : m;
  const hasTokens =
    Number.isFinite(promptTokens) &&
    Number.isFinite(completionTokens) &&
    (promptTokens > 0 || completionTokens > 0);
  const totalTokens = hasTokens ? promptTokens + completionTokens : 0;
  const hasDuration = typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0;

  const segments: ReactNode[] = [];
  if (modelShort) segments.push(<span key="model">{modelShort}</span>);
  if (hasTokens) segments.push(<span key="tok">{totalTokens.toLocaleString()} tok</span>);
  if (hasDuration) segments.push(<span key="s">{(durationMs / 1000).toFixed(1)}s</span>);

  if (segments.length === 0) return null;

  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
      <Zap className="h-2.5 w-2.5 shrink-0 text-primary" />
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {i > 0 ? <span className="text-border">•</span> : null}
          {seg}
        </Fragment>
      ))}
    </div>
  );
}
