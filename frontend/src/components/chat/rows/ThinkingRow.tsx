import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatDuration, parseDbTimestampMs } from "../../../utils/formatDuration";
import type { PlannerLlmStreamEntry, TitleLlmStreamEntry } from "../../../protocol/chatEntry";
import { cn } from "@/lib/utils";
import { ChatThreadIndent } from "../ChatMessageShell";
import { LlmMetaBadge } from "../LlmMetaBadge";

type ThinkingRowProps = {
  entry: PlannerLlmStreamEntry | TitleLlmStreamEntry;
};

function startTimestampMs(messageCreatedAt: string): number {
  if (!messageCreatedAt) return Date.now();
  const parsed = parseDbTimestampMs(messageCreatedAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function isDone(entry: PlannerLlmStreamEntry | TitleLlmStreamEntry): boolean {
  if (entry.status === "completed" || entry.status === "failed" || entry.status === "cancelled") {
    return true;
  }
  return typeof entry.thoughtMs === "number" && Number.isFinite(entry.thoughtMs);
}

export function ThinkingRow({ entry }: ThinkingRowProps) {
  const done = isDone(entry);
  const status = entry.status ?? "running";
  const failed = status === "failed";
  const cancelled = status === "cancelled";
  const [expanded, setExpanded] = useState(false);
  const [tick, setTick] = useState(0);
  const detailsWrapRef = useRef<HTMLDivElement | null>(null);
  const [autoscrollEnabled, setAutoscrollEnabled] = useState(false);

  const startedAt = useMemo(() => startTimestampMs(entry.createdAt), [entry.createdAt]);
  const requestText = String(entry.llmRequest || "").trim();
  const responseText = String(entry.llmResponse || "").trim();
  const errorText = String(entry.error ?? "").trim();
  const hasDetails = requestText.length > 0 || responseText.length > 0;
  const modelLabel = String(entry.llmModel ?? "").trim();
  const pt = entry.promptTokens;
  const cpt = entry.cachedPromptTokens;
  const ct = entry.completionTokens;
  const promptTokens =
    typeof pt === "number" && Number.isFinite(pt) ? pt : 0;
  const cachedPromptTokens =
    typeof cpt === "number" && Number.isFinite(cpt) ? cpt : 0;
  const completionTokens =
    typeof ct === "number" && Number.isFinite(ct) ? ct : 0;

  useEffect(() => {
    if (done) return undefined;
    const id = window.setInterval(() => setTick((x) => x + 1), 100);
    return () => window.clearInterval(id);
  }, [done]);

  useEffect(() => {
    if (expanded) setAutoscrollEnabled(true);
  }, [expanded]);

  useEffect(() => {
    if (done && !failed && !cancelled) setExpanded(false);
  }, [done, failed, cancelled]);

  useEffect(() => {
    if (failed || cancelled) setExpanded(true);
  }, [failed, cancelled]);

  useEffect(() => {
    if (!expanded || !autoscrollEnabled) return;
    const el = detailsWrapRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [expanded, autoscrollEnabled, requestText, responseText]);

  function onAutoscrollToggle() {
    const el = detailsWrapRef.current;
    const next = !autoscrollEnabled;
    setAutoscrollEnabled(next);
    if (!el || !next) return;
    el.scrollTop = el.scrollHeight;
  }

  void tick;
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const durationMs = typeof entry.thoughtMs === "number" && Number.isFinite(entry.thoughtMs)
    ? entry.thoughtMs
    : elapsedMs;
  const title = done
    ? failed
      ? `Thought failed after ${formatDuration(durationMs)}`
      : cancelled
        ? `Thought cancelled after ${formatDuration(durationMs)}`
        : `Thought completed in ${formatDuration(durationMs)}`
    : `Thinking… ${formatDuration(elapsedMs)}`;

  const titleClass = cn(
    "inline-flex min-h-[18px] items-center gap-2 text-xs font-semibold leading-tight text-slate-400",
    failed && "text-red-300",
    cancelled && "text-amber-700 dark:text-amber-300",
  );

  return (
    <ChatThreadIndent>
      <div
        className={cn(
          "relative box-border flex w-full min-h-0 flex-col items-start overflow-hidden border-0 bg-transparent p-0 text-xs text-muted-foreground shadow-none",
          done && "opacity-[0.98]",
          !done &&
            "bg-gradient-to-b from-white/[0.07] to-white/[0.03] after:pointer-events-none after:absolute after:left-[-75%] after:top-0 after:h-[1.125rem] after:w-[52%] after:animate-thinking-sweep after:bg-[linear-gradient(105deg,transparent_0%,rgba(255,255,255,0.16)_32%,rgba(255,255,255,0.5)_50%,rgba(255,255,255,0.16)_68%,transparent_100%)] motion-reduce:after:animate-none motion-reduce:after:opacity-0",
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          {hasDetails ? (
            <button
              type="button"
              className={cn(
                titleClass,
                "cursor-pointer appearance-none border-0 bg-transparent px-0 py-0 text-left",
              )}
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Hide thought details" : "Show thought details"}
            >
              <span>{title}</span>
              {expanded ? (
                <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
              )}
            </button>
          ) : (
            <div className={cn(titleClass, "leading-tight")}>{title}</div>
          )}
          <LlmMetaBadge
            model={modelLabel || undefined}
            promptTokens={promptTokens}
            cachedPromptTokens={cachedPromptTokens}
            completionTokens={completionTokens}
            showTokenBreakdown
          />
        </div>
        {failed ? (
          <div className="mt-0.5 text-[10px] leading-snug text-rose-300">
            Request failed. See details below.
          </div>
        ) : cancelled ? (
          <div className="mt-0.5 text-[10px] leading-snug text-amber-700 dark:text-amber-300">
            Request cancelled by user.
          </div>
        ) : null}
        {expanded && hasDetails ? (
          <div
            className="relative mt-1 flex max-h-[240px] flex-col gap-2 overflow-y-auto overflow-x-hidden"
            ref={detailsWrapRef}
          >
            <button
              type="button"
              className={cn(
                "sticky top-1.5 z-[1] ml-auto mr-1.5 inline-flex h-[22px] w-5 flex-col items-center justify-center gap-0 rounded-sm border border-border bg-muted px-0 pb-0 pt-px text-[10px] leading-none text-muted-foreground hover:text-foreground",
                autoscrollEnabled &&
                  "border-primary/70 bg-primary/15 text-foreground",
              )}
              onClick={onAutoscrollToggle}
              aria-label="Toggle autoscroll"
              title={autoscrollEnabled ? "Autoscroll on" : "Autoscroll off"}
              aria-pressed={autoscrollEnabled}
            >
              <span aria-hidden="true">↓</span>
              <span className="-mt-px opacity-90" aria-hidden="true">
                -
              </span>
            </button>
            <div className="flex flex-col gap-0.5">
              {requestText ? (
                <>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Request
                  </div>
                  <pre className="m-0 mt-1 whitespace-pre-wrap break-words rounded-md border border-border/60 bg-muted/40 p-2 font-mono text-xs leading-snug text-foreground first:mt-0">
                    {requestText}
                  </pre>
                </>
              ) : null}
              {responseText ? (
                <>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Response
                  </div>
                  <pre
                    className={cn(
                      "m-0 mt-1 max-h-none overflow-visible whitespace-pre-wrap break-words rounded-md border p-2 font-mono text-xs leading-snug first:mt-0",
                      "border-border/60 bg-muted/40 text-foreground",
                    )}
                  >
                    {responseText}
                  </pre>
                </>
              ) : null}
              {failed && errorText ? (
                <>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Error
                  </div>
                  <pre
                    className={cn(
                      "m-0 mt-1 max-h-none overflow-visible whitespace-pre-wrap break-words rounded-md border p-2 font-mono text-xs leading-snug first:mt-0",
                      failed
                        ? "border-destructive/30 bg-destructive/10 text-destructive"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-200",
                    )}
                  >
                    {errorText}
                  </pre>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </ChatThreadIndent>
  );
}
