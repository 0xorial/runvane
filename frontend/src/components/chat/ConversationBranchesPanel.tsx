import { useMemo, useState } from "react";
import { Activity, Bot, ChevronRight, Dot, FileText, MessageSquare, Sparkles, User, Wrench } from "lucide-react";
import { isThoughtStreamEntry, type ChatEntry } from "@/protocol/chatEntry";
import { notifyError } from "@/utils/toast";
import { cn } from "@/lib/utils";
import { useChatSessionContext } from "@/hooks/chatSessionContext";
import { useObservableValue } from "@/hooks/useObservable";
import type { ObservableItem } from "@/utils/observableCollection";

type ConversationBranchesPanelProps = {
  onAnchorEntrySelected?: (entryId: string) => void;
};

function entryPreview(entry: ChatEntry): string {
  if (entry.type === "user-message" || entry.type === "assistant-message") {
    const text = entry.text.trim();
    return text.length > 0 ? text : "(empty message)";
  }
  if (entry.type === "tool-invocation") {
    return `Tool: ${entry.toolId || "unknown"}`;
  }
  if (entry.type === "thought-prepare") {
    const summary = String(entry.title || "").trim();
    if (summary) return summary;
    const model = String(entry.llm?.model || "").trim();
    return model || "(context)";
  }
  if (entry.type === "thought-action") {
    const status = displayStatus(String(entry.status || "running").trim());
    const action = String(entry.action || "").trim();
    const toolName = String(entry.toolName || "").trim();
    const meta = [action, toolName].filter((x) => x.length > 0).join(" ");
    const body = [status, meta].filter((x) => x.length > 0).join(" ");
    return body ? `Decided: ${body}` : "Decided";
  }
  if (entry.type === "checkpoint-summary") {
    const head = entry.summaryText.trim().split(/\s+/).slice(0, 12).join(" ");
    return head ? `Summary: ${head}…` : "Summary";
  }
  // remaining: thought stream entries (planner/title/toolParams/summarize)
  const status = displayStatus(String(entry.status || "running").trim());
  const promptTokens = typeof entry.promptTokens === "number" && Number.isFinite(entry.promptTokens) ? entry.promptTokens : 0;
  const cachedPromptTokens =
    typeof entry.cachedPromptTokens === "number" && Number.isFinite(entry.cachedPromptTokens) ? entry.cachedPromptTokens : 0;
  const completionTokens =
    typeof entry.completionTokens === "number" && Number.isFinite(entry.completionTokens) ? entry.completionTokens : 0;
  const totalTokens = promptTokens + cachedPromptTokens + completionTokens;
  const tokenLabel = totalTokens > 0 ? `${totalTokens} tok` : "";
  const model = String(entry.llm?.model || "").trim();
  const meta = [model, tokenLabel].filter((x) => x.length > 0).join(" ");
  return [status, meta].filter((x) => x.length > 0).join(" ");
}

function displayStatus(status: string): string {
  return status === "completed" ? "" : status;
}

function entryIcon(entry: ChatEntry) {
  if (entry.type === "user-message") return <User className="mt-0.5 h-3 w-3 shrink-0" />;
  if (entry.type === "assistant-message") return <Bot className="mt-0.5 h-3 w-3 shrink-0" />;
  if (entry.type === "tool-invocation") return <Wrench className="mt-0.5 h-3 w-3 shrink-0" />;
  if (entry.type === "thought-prepare") return <FileText className="mt-0.5 h-3 w-3 shrink-0" />;
  if (isThoughtStreamEntry(entry)) {
    return <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />;
  }
  if (entry.type === "thought-action") {
    const toolName = String(entry.toolName || "").trim();
    const action = String(entry.action || "").trim();
    const usesTool = Boolean(toolName) || action === "tool_call";
    if (usesTool) return <Wrench className="mt-0.5 h-3 w-3 shrink-0" />;
    return <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" />;
  }
  return <Dot className="mt-0.5 h-3 w-3 shrink-0" />;
}

function byConversationIndexAsc(a: ChatEntry, b: ChatEntry): number {
  const ai = typeof a.conversationIndex === "number" ? a.conversationIndex : 0;
  const bi = typeof b.conversationIndex === "number" ? b.conversationIndex : 0;
  if (ai !== bi) return ai - bi;
  return String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
}

function deepestDescendantId(entryId: string, childrenByParent: Map<string | null, ObservableItem<ChatEntry>[]>): string {
  let cursor = entryId;
  for (;;) {
    const children = childrenByParent.get(cursor) ?? [];
    if (children.length === 0) return cursor;
    cursor = children[children.length - 1].id;
  }
}

export function ConversationBranchesPanel({ onAnchorEntrySelected }: ConversationBranchesPanelProps) {
  const { conversationId, allEntries, activePathEntries, activeLeafId, setActiveLeaf } = useChatSessionContext();
  const [switchingToEntryId, setSwitchingToEntryId] = useState<string | null>(null);

  const activePathIds = useMemo(
    () => new Set(activePathEntries.map((row$) => row$.id)),
    [activePathEntries],
  );

  // Tree topology is derived from immutable fields (id, parentId,
  // conversationIndex), so we sort once on the rows array. Per-entry mutable
  // fields (status, tokens, text deltas) re-render via per-row subscription
  // inside BranchNode (`useObservableValue(entry$)`).
  const sortedRows = useMemo(
    () =>
      [...allEntries].sort((a, b) => byConversationIndexAsc(a.get(), b.get())),
    [allEntries],
  );

  const childrenByParent = useMemo(() => {
    const idSet = new Set(sortedRows.map((row$) => row$.id));
    const map = new Map<string | null, ObservableItem<ChatEntry>[]>();
    for (const row$ of sortedRows) {
      const parentId = row$.get().parentId;
      const bucket = parentId && !idSet.has(parentId) ? null : parentId;
      const list = map.get(bucket) ?? [];
      list.push(row$);
      map.set(bucket, list);
    }
    return map;
  }, [sortedRows]);

  const rootNodes = childrenByParent.get(null) ?? [];

  async function handleSelectEntry(entryId: string) {
    if (!conversationId) return;
    const targetLeafId = deepestDescendantId(entryId, childrenByParent);
    if (!targetLeafId) return;
    setSwitchingToEntryId(targetLeafId);
    try {
      await setActiveLeaf(targetLeafId);
      onAnchorEntrySelected?.(entryId);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      notifyError(`Failed to switch branch: ${detail}`);
    } finally {
      setSwitchingToEntryId(null);
    }
  }

  if (!conversationId) {
    return <div className="p-3 text-xs text-muted-foreground">No conversation selected.</div>;
  }

  if (rootNodes.length === 0) {
    return <div className="p-3 text-xs text-muted-foreground">No messages yet.</div>;
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2 px-1">
        <Activity className="h-4 w-4 text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Activity</h3>
      </div>
      <div className="text-[11px]">
        {rootNodes.map((row$) => (
          <BranchNode
            key={row$.id}
            entry$={row$}
            branchDepth={0}
            childrenByParent={childrenByParent}
            activePathIds={activePathIds}
            activeLeafId={activeLeafId}
            switchingToEntryId={switchingToEntryId}
            onSelectEntry={handleSelectEntry}
          />
        ))}
      </div>
    </div>
  );
}

function BranchNode({
  entry$,
  branchDepth,
  childrenByParent,
  activePathIds,
  activeLeafId,
  switchingToEntryId,
  onSelectEntry,
}: {
  entry$: ObservableItem<ChatEntry>;
  branchDepth: number;
  childrenByParent: Map<string | null, ObservableItem<ChatEntry>[]>;
  activePathIds: Set<string>;
  activeLeafId: string | null;
  switchingToEntryId: string | null;
  onSelectEntry: (entryId: string) => void;
}) {
  const entry = useObservableValue(entry$);
  const children = childrenByParent.get(entry.id) ?? [];
  const siblings = childrenByParent.get(entry.parentId) ?? [];
  const hasSiblings = siblings.length > 1;
  const nextBranchDepth = branchDepth + (hasSiblings ? 1 : 0);
  const isActive = activePathIds.has(entry.id);
  const isLeaf = children.length === 0;
  const isSwitching = switchingToEntryId === entry.id;
  const [userExpanded, setUserExpanded] = useState(false);
  const isBranchPoint = hasSiblings && !isActive && children.length > 0;
  const childrenVisible = !isBranchPoint || userExpanded;
  const showToggle = isBranchPoint;

  return (
    <div>
      <div
        className={cn(
          "flex w-full items-start gap-1 rounded text-left transition-colors",
          isActive
            ? "bg-primary/10 text-foreground"
            : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
          isSwitching && "cursor-wait opacity-60",
        )}
        style={{ paddingLeft: `${branchDepth * 12 + 6}px` }}
      >
        {showToggle ? (
          <button
            type="button"
            aria-label={userExpanded ? "Collapse branch" : "Expand branch"}
            onClick={(e) => {
              e.stopPropagation();
              setUserExpanded((v) => !v);
            }}
            className="mt-1 flex h-3 w-3 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn("h-3 w-3 transition-transform", userExpanded ? "rotate-90" : "")} />
          </button>
        ) : (
          <span className="mt-1 h-3 w-3 shrink-0" />
        )}
        <button
          type="button"
          disabled={isSwitching}
          onClick={() => {
            void onSelectEntry(entry.id);
          }}
          className="flex flex-1 items-start gap-1.5 rounded px-1.5 py-1 text-left"
        >
          <span className={cn(isActive ? "text-primary" : "text-muted-foreground")}>{entryIcon(entry)}</span>
          <span className="flex-1 truncate">{entryPreview(entry)}</span>
          {isLeaf && activeLeafId === entry.id ? (
            <span className="text-[9px] font-semibold uppercase tracking-wider text-primary">head</span>
          ) : null}
        </button>
      </div>
      {childrenVisible
        ? children.map((child$) => (
            <BranchNode
              key={child$.id}
              entry$={child$}
              branchDepth={nextBranchDepth}
              childrenByParent={childrenByParent}
              activePathIds={activePathIds}
              activeLeafId={activeLeafId}
              switchingToEntryId={switchingToEntryId}
              onSelectEntry={onSelectEntry}
            />
          ))
        : null}
    </div>
  );
}
