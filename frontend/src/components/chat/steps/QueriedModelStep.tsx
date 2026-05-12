import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Sparkles } from "lucide-react";
import type { ChatEntry, PlannerLlmStreamEntry, TitleLlmStreamEntry } from "@/protocol/chatEntry";
import { parseDbTimestampMs } from "@/utils/formatDuration";
import { reprocessThought } from "@/api/client";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { notifyError } from "@/utils/toast";
import { useChatSessionContext } from "@/hooks/chatSessionContext";
import { ChatThreadIndent } from "../ChatMessageShell";

function byConversationIndexAsc(a: ChatEntry, b: ChatEntry): number {
  if (a.conversationIndex !== b.conversationIndex) return a.conversationIndex - b.conversationIndex;
  return a.createdAt.localeCompare(b.createdAt);
}

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
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedResponse, setEditedResponse] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [switchingBranch, setSwitchingBranch] = useState(false);
  const { allEntries, setActiveLeaf } = useChatSessionContext();

  const sortedAll = useMemo(
    () => allEntries.map((row$) => row$.get()).sort(byConversationIndexAsc),
    [allEntries],
  );
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, ChatEntry[]>();
    for (const row of sortedAll) {
      const list = map.get(row.parentId) ?? [];
      list.push(row);
      map.set(row.parentId, list);
    }
    return map;
  }, [sortedAll]);
  const siblings = useMemo(() => childrenByParent.get(entry.parentId) ?? [], [childrenByParent, entry.parentId]);
  const activeSiblingIndex = useMemo(
    () => siblings.findIndex((row) => row.id === entry.id),
    [siblings, entry.id],
  );

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
  const modelLabel = String(entry.llmModel || "").trim();
  const responseText = String(entry.llmResponse || "").trim();
  const errorText = String(entry.error || "").trim();
  const canEditResponse = entry.type === "planner_llm_stream" && done && Boolean(conversationId);
  const hasSiblingBranches = siblings.length > 1 && activeSiblingIndex >= 0;
  const meta = `${modelLabel || "unknown model"} · ${completionTokens} out tok · ${formatDurationMs(durationMs)}`;

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

  function deepestDescendantId(entryId: string): string {
    let cursor = entryId;
    for (;;) {
      const children = childrenByParent.get(cursor) ?? [];
      if (children.length === 0) return cursor;
      cursor = children[children.length - 1].id;
    }
  }

  async function onSwitchSiblingBranch(offset: -1 | 1) {
    if (!conversationId || !hasSiblingBranches || switchingBranch) return;
    const nextIndex = (activeSiblingIndex + offset + siblings.length) % siblings.length;
    const sibling = siblings[nextIndex];
    if (!sibling) return;
    setSwitchingBranch(true);
    try {
      await setActiveLeaf(deepestDescendantId(sibling.id));
    } catch (e) {
      notifyError(`Failed to switch branch: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSwitchingBranch(false);
    }
  }

  void tick;

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
            <Sparkles className="h-3 w-3" />
            <span className="font-medium">Queried model</span>
            <span className="opacity-60">· {meta}</span>
          </button>
          {hasSiblingBranches ? (
            <div className="ml-1 inline-flex items-center gap-0.5 rounded bg-secondary/60 px-1 py-0.5 text-[10px] text-muted-foreground">
              <button
                type="button"
                disabled={switchingBranch}
                onClick={() => {
                  void onSwitchSiblingBranch(-1);
                }}
                className="transition-colors hover:text-foreground disabled:opacity-50"
                aria-label="Previous branch"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <span className="font-mono tabular-nums">
                {activeSiblingIndex + 1}/{siblings.length}
              </span>
              <button
                type="button"
                disabled={switchingBranch}
                onClick={() => {
                  void onSwitchSiblingBranch(1);
                }}
                className="transition-colors hover:text-foreground disabled:opacity-50"
                aria-label="Next branch"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          ) : null}
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
                            onClick={async () => {
                              if (!conversationId) return;
                              setSubmitError(null);
                              setIsSubmitting(true);
                              try {
                                await reprocessThought(conversationId, entry.id, editedResponse);
                                setEditing(false);
                              } catch (e) {
                                setSubmitError(e instanceof Error ? e.message : String(e));
                              } finally {
                                setIsSubmitting(false);
                              }
                            }}
                            className="rounded bg-primary px-2 py-0.5 text-[10px] text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                          >
                            {isSubmitting ? "Reprocessing..." : "Reprocess"}
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
                  <Textarea
                    value={editedResponse}
                    onChange={(e) => setEditedResponse(e.target.value)}
                    className="min-h-[120px] text-xs font-mono"
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
              <span>prompt: {promptTokens}t</span>
              <span>cached: {cachedPromptTokens}t</span>
              <span>completion: {completionTokens}t</span>
              <span>total: {totalTokens}t</span>
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
