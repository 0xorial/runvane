import { useEffect, useMemo, useState } from "react";
import { Brain, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import type { PlannerLlmStreamEntry, TitleLlmStreamEntry } from "@/protocol/chatEntry";
import { parseDbTimestampMs } from "@/utils/formatDuration";
import { getConversationMessages, reprocessThought, setConversationActiveLeaf } from "@/api/client";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ChatEntry } from "@/protocol/chatEntry";
import { notifyError } from "@/utils/toast";

type ThinkingItemProps = {
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

export function ThinkingItem({ entry, conversationId }: ThinkingItemProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedResponse, setEditedResponse] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [switchingBranch, setSwitchingBranch] = useState(false);
  const [siblings, setSiblings] = useState<ChatEntry[]>([]);
  const [activeSiblingIndex, setActiveSiblingIndex] = useState(-1);
  const [childrenByParent, setChildrenByParent] = useState<Map<string | null, ChatEntry[]>>(new Map());

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
  const requestText = String(entry.llmRequest || "").trim();
  const responseText = String(entry.llmResponse || "").trim();
  const errorText = String(entry.error || "").trim();
  const parseResultText = entry.type === "planner_llm_stream" && entry.parseResult ? JSON.stringify(entry.parseResult, null, 2) : "";
  const canEditResponse = entry.type === "planner_llm_stream" && done && Boolean(conversationId);
  const hasSiblingBranches = siblings.length > 1 && activeSiblingIndex >= 0;

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

  useEffect(() => {
    if (!conversationId) {
      setSiblings([]);
      setActiveSiblingIndex(-1);
      setChildrenByParent(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await getConversationMessages(conversationId, { all: true });
        if (cancelled) return;
        rows.sort((a, b) =>
          a.conversationIndex !== b.conversationIndex
            ? a.conversationIndex - b.conversationIndex
            : a.createdAt.localeCompare(b.createdAt),
        );
        const byParent = new Map<string | null, ChatEntry[]>();
        for (const row of rows) {
          const list = byParent.get(row.parentId) ?? [];
          list.push(row);
          byParent.set(row.parentId, list);
        }
        const sameParent = byParent.get(entry.parentId) ?? [];
        setChildrenByParent(byParent);
        setSiblings(sameParent);
        setActiveSiblingIndex(sameParent.findIndex((row) => row.id === entry.id));
      } catch (e) {
        if (cancelled) return;
        notifyError(`Failed to load sibling branches: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, entry.id, entry.parentId]);

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
      const leafId = deepestDescendantId(sibling.id);
      await setConversationActiveLeaf(conversationId, leafId);
      window.dispatchEvent(new Event("runvane:refresh-chat"));
    } catch (e) {
      notifyError(`Failed to switch branch: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSwitchingBranch(false);
    }
  }

  void tick;
  const title = done
    ? failed
      ? "Thought failed"
      : cancelled
        ? "Thought cancelled"
        : "Thought"
    : "Thinking";

  return (
    <div className="max-w-3xl px-0">
      <div className="group/think my-1.5 border-l-2 border-border/60 pl-3">
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
            <Brain className="h-3 w-3" />
            <span className="font-medium">{title}</span>
            <span className="opacity-70">
              · {status}
              {modelLabel ? ` · ${modelLabel}` : ""}
              {totalTokens > 0 ? ` · ${totalTokens} tok` : ""}
              · {formatDurationMs(durationMs)}
            </span>
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
          <div className="mt-2 space-y-2 text-xs">
            {requestText ? <ReadOnlySection label="Request" value={requestText} /> : null}
            {responseText || editing ? (
              <div className="space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {editing ? "Edited response" : "Response"}
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
                                window.dispatchEvent(new Event("runvane:refresh-chat"));
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
            {parseResultText ? <ReadOnlySection label="Parse result" value={parseResultText} /> : null}
            {failed && errorText ? <ReadOnlySection label="Error" value={errorText} danger /> : null}
          </div>
        ) : null}
      </div>
    </div>
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
