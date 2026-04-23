import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, MessageSquare, Sparkles, Wrench } from "lucide-react";
import type { PlannerLlmStreamEntry, ThoughtActionEntry, ThoughtPrepareEntry, TitleLlmStreamEntry, ChatEntry } from "@/protocol/chatEntry";
import { getConversationMessages, reprocessThought, setConversationActiveLeaf } from "@/api/client";
import { notifyError } from "@/utils/toast";
import { Textarea } from "@/components/ui/textarea";
import { parseDbTimestampMs } from "@/utils/formatDuration";
import { cn } from "@/lib/utils";
import { ChatThreadIndent } from "../ChatMessageShell";

type ThoughtTripletRowProps = {
  prepare: ThoughtPrepareEntry;
  queried: PlannerLlmStreamEntry | TitleLlmStreamEntry;
  action: ThoughtActionEntry;
  conversationId: string | null;
};

type StepKind = "context" | "query" | "action";

function isDone(entry: PlannerLlmStreamEntry | TitleLlmStreamEntry): boolean {
  if (entry.status === "completed" || entry.status === "failed" || entry.status === "cancelled") return true;
  return typeof entry.thoughtMs === "number" && Number.isFinite(entry.thoughtMs);
}

function startTimestampMs(createdAt: string): number {
  const parsed = parseDbTimestampMs(createdAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
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

function deepestDescendantId(entryId: string, childrenByParent: Map<string | null, ChatEntry[]>): string {
  let cursor = entryId;
  for (;;) {
    const children = childrenByParent.get(cursor) ?? [];
    if (children.length === 0) return cursor;
    cursor = children[children.length - 1].id;
  }
}

function StepChip({
  label,
  icon,
  active,
  onClick,
  branchInfo,
  onPrevBranch,
  onNextBranch,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  branchInfo?: { index: number; total: number };
  onPrevBranch?: () => void;
  onNextBranch?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 inline-flex items-center justify-center gap-1 rounded px-2 py-1 text-[11px] transition-colors",
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      {icon}
      <span className="font-medium">{label}</span>
      {branchInfo && onPrevBranch && onNextBranch ? (
        <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onPrevBranch();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPrevBranch();
              }
            }}
          >
            <ChevronLeft className="h-2.5 w-2.5" />
          </span>
          <span className="font-mono tabular-nums">
            {branchInfo.index + 1}/{branchInfo.total}
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onNextBranch();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onNextBranch();
              }
            }}
          >
            <ChevronRight className="h-2.5 w-2.5" />
          </span>
        </span>
      ) : null}
    </button>
  );
}

export function ThoughtTripletRow({ prepare, queried, action, conversationId }: ThoughtTripletRowProps) {
  const [expanded, setExpanded] = useState<StepKind | null>(null);
  const [switchingBranch, setSwitchingBranch] = useState(false);
  const [siblings, setSiblings] = useState<ChatEntry[]>([]);
  const [activeSiblingIndex, setActiveSiblingIndex] = useState(-1);
  const [childrenByParent, setChildrenByParent] = useState<Map<string | null, ChatEntry[]>>(new Map());
  const [editing, setEditing] = useState(false);
  const [editedResponse, setEditedResponse] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const done = isDone(queried);
  const status = queried.status ?? "running";
  const failed = status === "failed";
  const cancelled = status === "cancelled";
  const startedAt = useMemo(() => startTimestampMs(queried.createdAt), [queried.createdAt]);
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const durationMs = typeof queried.thoughtMs === "number" && Number.isFinite(queried.thoughtMs) ? queried.thoughtMs : elapsedMs;
  const promptTokens = typeof queried.promptTokens === "number" && Number.isFinite(queried.promptTokens) ? queried.promptTokens : 0;
  const cachedPromptTokens =
    typeof queried.cachedPromptTokens === "number" && Number.isFinite(queried.cachedPromptTokens) ? queried.cachedPromptTokens : 0;
  const completionTokens =
    typeof queried.completionTokens === "number" && Number.isFinite(queried.completionTokens) ? queried.completionTokens : 0;
  const totalTokens = promptTokens + cachedPromptTokens + completionTokens;
  const modelLabel = String(queried.llmModel || "").trim();
  const responseText = String(queried.llmResponse || "").trim();
  const errorText = String(queried.error || "").trim();
  const parseResultText = action.parseResult ? JSON.stringify(action.parseResult, null, 2) : "";
  const canEditResponse = queried.type === "planner_llm_stream" && done && Boolean(conversationId);
  const hasSiblingBranches = siblings.length > 1 && activeSiblingIndex >= 0;
  const hasTools = String(action.toolName || "").trim().length > 0;

  useEffect(() => {
    if (done) return undefined;
    const id = window.setInterval(() => setTick((x) => x + 1), 100);
    return () => window.clearInterval(id);
  }, [done]);

  useEffect(() => {
    if (failed || cancelled) setExpanded("query");
  }, [failed, cancelled]);

  useEffect(() => {
    if (!conversationId) {
      setSiblings([]);
      setActiveSiblingIndex(-1);
      setChildrenByParent(new Map());
      return;
    }
    let cancelledLocal = false;
    void (async () => {
      try {
        const rows = await getConversationMessages(conversationId, { all: true });
        if (cancelledLocal) return;
        rows.sort((a, b) =>
          a.conversationIndex !== b.conversationIndex ? a.conversationIndex - b.conversationIndex : a.createdAt.localeCompare(b.createdAt),
        );
        const byParent = new Map<string | null, ChatEntry[]>();
        for (const row of rows) {
          const list = byParent.get(row.parentId) ?? [];
          list.push(row);
          byParent.set(row.parentId, list);
        }
        const sameParent = byParent.get(queried.parentId) ?? [];
        setChildrenByParent(byParent);
        setSiblings(sameParent);
        setActiveSiblingIndex(sameParent.findIndex((row) => row.id === queried.id));
      } catch (e) {
        if (cancelledLocal) return;
        notifyError(`Failed to load sibling branches: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => {
      cancelledLocal = true;
    };
  }, [conversationId, queried.id, queried.parentId]);

  async function onSwitchSiblingBranch(offset: -1 | 1) {
    if (!conversationId || !hasSiblingBranches || switchingBranch) return;
    const nextIndex = (activeSiblingIndex + offset + siblings.length) % siblings.length;
    const sibling = siblings[nextIndex];
    if (!sibling) return;
    setSwitchingBranch(true);
    try {
      const leafId = deepestDescendantId(sibling.id, childrenByParent);
      await setConversationActiveLeaf(conversationId, leafId);
      window.dispatchEvent(new Event("runvane:refresh-chat"));
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
        <div className="flex items-center gap-1 py-0.5">
          <StepChip
            icon={<FileText className="h-3 w-3" />}
            label="Context"
            active={expanded === "context"}
            onClick={() => setExpanded((s) => (s === "context" ? null : "context"))}
          />
          <span className="opacity-40">→</span>
          <StepChip
            icon={<Sparkles className="h-3 w-3" />}
            label="Query"
            active={expanded === "query"}
            onClick={() => setExpanded((s) => (s === "query" ? null : "query"))}
            branchInfo={hasSiblingBranches ? { index: activeSiblingIndex, total: siblings.length } : undefined}
            onPrevBranch={hasSiblingBranches ? () => void onSwitchSiblingBranch(-1) : undefined}
            onNextBranch={hasSiblingBranches ? () => void onSwitchSiblingBranch(1) : undefined}
          />
          <span className="opacity-40">→</span>
          <StepChip
            icon={hasTools ? <Wrench className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
            label="Action"
            active={expanded === "action"}
            onClick={() => setExpanded((s) => (s === "action" ? null : "action"))}
          />
        </div>

        {expanded === "context" ? (
          <div className="mt-1.5 ml-1 space-y-1 text-xs">
            <div className="text-[10px] text-muted-foreground">{modelLabel || "unknown model"}</div>
            <pre className="whitespace-pre-wrap break-words rounded border border-border/50 bg-muted/40 px-2 py-1.5 font-mono text-[11px] text-foreground/90">
              {prepare.requestText}
            </pre>
          </div>
        ) : null}

        {expanded === "query" ? (
          <div className="mt-1.5 ml-1 space-y-2 text-xs">
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
              <span>status: {status}</span>
              <span>model: {modelLabel || "unknown"}</span>
              <span>completion: {completionTokens}t</span>
              <span>total: {totalTokens}t</span>
              <span>duration: {formatDurationMs(durationMs)}</span>
            </div>
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
                              setEditedResponse(String(queried.llmResponse || ""));
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
                                await reprocessThought(conversationId, queried.id, editedResponse);
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
                            setEditedResponse(String(queried.llmResponse || ""));
                            setSubmitError(null);
                            setEditing(true);
                          }}
                          className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        >
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
            {failed && errorText ? (
              <pre className="whitespace-pre-wrap break-words rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 font-mono text-[11px] text-destructive">
                {errorText}
              </pre>
            ) : null}
          </div>
        ) : null}

        {expanded === "action" ? (
          <div className="mt-1.5 ml-1 space-y-1 text-xs">
            <div className="text-[10px] text-muted-foreground">
              {action.status}
              {action.action ? ` · ${action.action}` : ""}
            </div>
            {parseResultText ? (
              <pre className="whitespace-pre-wrap break-words rounded border border-border/50 bg-muted/40 px-2 py-1.5 font-mono text-[11px] text-foreground/90">
                {parseResultText}
              </pre>
            ) : (
              <div className="text-[11px] text-muted-foreground">No parse result.</div>
            )}
          </div>
        ) : null}
      </div>
    </ChatThreadIndent>
  );
}

