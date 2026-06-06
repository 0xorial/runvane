import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Pencil, Sparkles } from "lucide-react";
import type { PlannerLlmStreamEntry, TitleLlmStreamEntry } from "@/protocol/chatEntry";
import { parseDbTimestampMs } from "@/utils/formatDuration";
import { reprocessThought } from "@/api/client";
import { useChatSessionContext } from "@/hooks/chatSessionContext";
import { ZodJsonEditor } from "@/components/ui/ZodJsonEditor";
import { AgenticPlannerOutputSchema } from "@/lib/editorSchemas";
import { cn } from "@/lib/utils";
import { ChatThreadIndent } from "../ChatMessageShell";
import { formatTokenCount } from "@/utils/formatTokenCount";
import { usePricingMap } from "@/hooks/usePricingMap";
import { TokenTooltip } from "@/components/ui/TokenTooltip";
import { ModifierEnterHint } from "@/components/ui/ModifierEnterHint";

type QueriedModelStepProps = {
  entry: PlannerLlmStreamEntry | TitleLlmStreamEntry;
  conversationId: string | null;
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

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 10) return `${sec.toFixed(1)}s`;
  if (sec < 60) return `${Math.round(sec)}s`;
  const min = Math.floor(sec / 60);
  const remSec = Math.round(sec - min * 60);
  return `${min}m ${remSec}s`;
}

export function QueriedModelStep({ entry, conversationId }: QueriedModelStepProps) {
  const { setActiveLeaf } = useChatSessionContext();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedResponse, setEditedResponse] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const pricingByModel = usePricingMap();

  const done = isDone(entry);
  const status = entry.status ?? "running";
  const failed = status === "failed";
  const cancelled = status === "cancelled";
  const startedAt = useMemo(() => startTimestampMs(entry.createdAt), [entry.createdAt]);
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const durationMs = typeof entry.thoughtMs === "number" && Number.isFinite(entry.thoughtMs) ? entry.thoughtMs : elapsedMs;
  const promptTokens = typeof entry.promptTokens === "number" && Number.isFinite(entry.promptTokens) ? entry.promptTokens : 0;
  const cachedPromptTokens =
    typeof entry.cachedPromptTokens === "number" && Number.isFinite(entry.cachedPromptTokens) ? entry.cachedPromptTokens : 0;
  const completionTokens =
    typeof entry.completionTokens === "number" && Number.isFinite(entry.completionTokens) ? entry.completionTokens : 0;
  const totalTokens = promptTokens + cachedPromptTokens + completionTokens;
  const modelLabel = String(entry.llm?.model || "").trim();
  const responseText = String(entry.llmResponse || "").trim();
  const errorText = String(entry.error || "").trim();
  const canEditResponse = entry.type === "planner_llm_stream" && done && Boolean(conversationId);
  const pricing = pricingByModel.get(modelLabel);

  useEffect(() => {
    if (done) return undefined;
    const id = window.setInterval(() => setTick((x) => x + 1), 100);
    return () => window.clearInterval(id);
  }, [done]);

  useEffect(() => {
    if (failed || cancelled) setOpen(true);
  }, [failed, cancelled]);

  useEffect(() => {
    if (done && !failed && !cancelled) setOpen(false);
  }, [done, failed, cancelled]);

  useEffect(() => {
    if (!editing) return;
    setEditedResponse(String(entry.llmResponse || ""));
  }, [editing, entry.llmResponse]);

  void tick;

  async function submitReprocess() {
    if (!conversationId || isSubmitting || editedResponse.trim().length === 0) return;
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const result = await reprocessThought(conversationId, entry.id, editedResponse);
      await setActiveLeaf(result.data.leafEntryId);
      setEditing(false);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ChatThreadIndent className="py-0">
      <div className="my-0 border-l-2 border-border/60 pl-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 py-0.5 text-[11px] transition-colors",
              failed ? "text-destructive hover:text-destructive/90" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ChevronRight className={cn("h-3 w-3 transition-transform", open ? "rotate-90" : "")} />
            {failed || cancelled ? (
              <AlertTriangle className="h-3 w-3 text-destructive" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            <span className="font-medium">Queried model</span>
            <span className="opacity-60">
              · {modelLabel || "unknown model"}
              {totalTokens > 0 ? (
                <> · <TokenTooltip promptTokens={promptTokens} cachedTokens={cachedPromptTokens} completionTokens={completionTokens} pricing={pricing}>{formatTokenCount(totalTokens)}</TokenTooltip></>
              ) : null}
              {" · "}{formatDurationMs(durationMs)}
            </span>
          </button>
        </div>

        {open ? (
          <div className="mt-1.5 ml-4 space-y-2 text-xs">
            {responseText || editing ? (
              <div className="space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {editing ? "Edited response" : "Raw response"}
                  </div>
                  {canEditResponse ? (
                    <div className="flex items-center gap-1">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(false);
                              setSubmitError(null);
                              setEditedResponse(String(entry.llmResponse || ""));
                            }}
                            className="rounded px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={isSubmitting || editedResponse.trim().length === 0 || !conversationId}
                            onClick={() => {
                              void submitReprocess();
                            }}
                            className="rounded bg-primary px-2 py-0.5 text-[10px] text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                          >
                            {isSubmitting ? (
                              "Reprocessing..."
                            ) : (
                              <span className="inline-flex items-center gap-1.5">
                                Reprocess
                                <ModifierEnterHint className="text-primary-foreground/70" />
                              </span>
                            )}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditedResponse(String(entry.llmResponse || ""));
                            setSubmitError(null);
                            setEditing(true);
                          }}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                          title="Edit response"
                        >
                          <Pencil className="h-3 w-3" />
                          Edit
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
                {editing ? (
                  <ZodJsonEditor
                    schema={AgenticPlannerOutputSchema}
                    value={editedResponse}
                    onChange={setEditedResponse}
                    height={220}
                    onSubmitShortcut={() => {
                      void submitReprocess();
                    }}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap break-words rounded border border-border/50 bg-muted/40 px-2 py-1.5 font-mono text-[11px] text-foreground/90">
                    {responseText}
                  </pre>
                )}
                {submitError ? <div className="text-[11px] text-destructive">{submitError}</div> : null}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
              <span>status: {status}</span>
              <span>prompt: {formatTokenCount(promptTokens)}</span>
              <span>cached: {formatTokenCount(cachedPromptTokens)}</span>
              <span>completion: {formatTokenCount(completionTokens)}</span>
              <span>total: {formatTokenCount(totalTokens)}</span>
            </div>
            {failed && errorText ? <ReadOnlySection label="Error" value={errorText} danger /> : null}
          </div>
        ) : null}
      </div>
    </ChatThreadIndent>
  );
}

function ReadOnlySection({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <pre
        className={cn(
          "whitespace-pre-wrap break-words rounded border px-2 py-1.5 font-mono text-[11px]",
          danger ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border/50 bg-muted/40 text-foreground/90",
        )}
      >
        {value}
      </pre>
    </div>
  );
}
