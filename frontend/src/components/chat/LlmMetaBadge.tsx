import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { TokenUsageMapper, type EntryTokenUsage } from "../../../../backend/src/contracts/token-usage";

/** frontend2/src/components/chat/LLMRequestBadge.tsx — only renders when there is something to show */
export type LlmMetaBadgeProps = {
  model?: string;
  usage?: EntryTokenUsage;
  durationMs?: number;
  showTokenBreakdown?: boolean;
  /** `null` = cost unknown (missing pricing), `undefined` = don't show, `number` = formatted value */
  estimatedCostUsd?: number | null;
  /** Model names that lack pricing — used to deep-link "set pricing" to the right rows. */
  unpricedModels?: string[];
  className?: string;
};

function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}b`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return value.toLocaleString();
}

function formatExactUsd(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
}

function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return "<0.01";
  if (value < 0 && value > -0.01) return ">-0.01";
  return value.toFixed(2);
}

export function LlmMetaBadge({
  model,
  usage,
  durationMs,
  showTokenBreakdown = false,
  estimatedCostUsd,
  unpricedModels,
  className,
}: LlmMetaBadgeProps) {
  const m = String(model ?? "").trim();
  const modelShort = m.includes("/") ? (m.split("/").pop() ?? m) : m;
  const normalizedUsage = TokenUsageMapper.fromEntryFields(usage ?? {});
  const hasTokens = normalizedUsage !== undefined;
  const totalTokens = TokenUsageMapper.totalDisplayedTokens(normalizedUsage);
  const hasDuration = typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0;

  const segments: ReactNode[] = [];
  if (modelShort) segments.push(<span key="model">{modelShort}</span>);
  if (hasTokens) {
    const prompt = normalizedUsage.promptTokens;
    const cachedPrompt = normalizedUsage.cachedPromptTokens ?? 0;
    const completion = normalizedUsage.completionTokens;
    const promptExact = prompt.toLocaleString();
    const cachedPromptExact = cachedPrompt.toLocaleString();
    const completionExact = completion.toLocaleString();
    const totalExact = totalTokens.toLocaleString();
    segments.push(
      showTokenBreakdown ? (
        <span key="tok" title={`in ${promptExact} / cached ${cachedPromptExact} / out ${completionExact} tok`}>
          in {formatCompactNumber(prompt)} / out {formatCompactNumber(completion)} tok
        </span>
      ) : (
        <span key="tok" title={`${totalExact} tok`}>
          {formatCompactNumber(totalTokens)} tok
        </span>
      ),
    );
    if (cachedPrompt > 0) {
      segments.push(
        <span key="cached" title={`${cachedPromptExact} cached input tok`}>
          cached {formatCompactNumber(cachedPrompt)} tok
        </span>,
      );
    }
  }
  if (hasDuration) segments.push(<span key="s">{(durationMs / 1000).toFixed(1)}s</span>);
  if (estimatedCostUsd === null) {
    const focusQuery =
      unpricedModels && unpricedModels.length > 0
        ? `?focus=${encodeURIComponent(unpricedModels.join(","))}`
        : "";
    segments.push(
      <Link
        key="usd"
        to={`/settings/model-pricing${focusQuery}`}
        title="Pricing not configured for one or more models used. Click to configure."
        className="text-muted-foreground/70 underline decoration-dotted decoration-muted-foreground/40 underline-offset-2 hover:text-foreground hover:decoration-foreground"
      >
        set pricing
      </Link>,
    );
  } else if (typeof estimatedCostUsd === "number") {
    segments.push(
      <span key="usd" title={`$${formatExactUsd(estimatedCostUsd)}`}>
        ${formatUsd(estimatedCostUsd)}
      </span>,
    );
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
