import { useMemo, useState } from "react";
import { Activity, Bot, ChevronRight, Dot, FileText, MessageSquare, Sparkles, User, Wrench } from "lucide-react";
import { isThoughtStreamEntry, type ChatEntry } from "@/protocol/chatEntry";
import { notifyError } from "@/utils/toast";
import { cn } from "@/lib/utils";
import { useChatSessionContext } from "@/hooks/chatSessionContext";
import { childEntries, siblingsOf } from "@/lib/linkedChatEntry";
import type { ObservableItemCollection } from "@/utils/observableCollection";
import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
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
  if (entry.type === "summarize_attachment_llm_stream") {
    const name = String(entry.filename ?? "").trim();
    const status = displayStatus(String(entry.status || "running").trim());
    return [status, name ? `Summarize: ${name}` : "Summarize attachment"].filter((x) => x.length > 0).join(" ");
  }
  // remaining: thought stream entries (planner/title/toolParams/summarize/...)
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

export function ConversationBranchesPanel({ onAnchorEntrySelected }: ConversationBranchesPanelProps) {
  const { conversationId, sessionStore, allEntries, activePathEntries, switchToBranch } = useChatSessionContext();
  const pathTipId = activePathEntries.length > 0 ? activePathEntries[activePathEntries.length - 1].id : null;
  const [switchingToEntryId, setSwitchingToEntryId] = useState<string | null>(null);

  const activePathIds = useMemo(
    () => new Set(activePathEntries.map((row$) => row$.id)),
    [activePathEntries],
  );

  const rowById = useMemo(() => new Map(allEntries.map((row$) => [row$.id, row$])), [allEntries]);

  const childRowsOf = useMemo(
    () =>
      (parentId: string | null): ObservableItem<LinkedChatEntry>[] =>
        childEntries(sessionStore, parentId)
          .map((entry) => rowById.get(entry.id))
          .filter((row$): row$ is ObservableItem<LinkedChatEntry> => row$ != null),
    [sessionStore, rowById],
  );

  const rootNodes = childRowsOf(null);

  async function handleSelectEntry(entryId: string) {
    if (!conversationId) return;
    setSwitchingToEntryId(entryId);
    try {
      await switchToBranch(entryId);
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
      <div className="text-[11px] leading-snug">
        {rootNodes.map((row$) => (
          <BranchNode
            key={row$.id}
            entry$={row$}
            branchDepth={0}
            childRowsOf={childRowsOf}
            sessionStore={sessionStore}
            activePathIds={activePathIds}
            pathTipId={pathTipId}
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
  childRowsOf,
  sessionStore,
  activePathIds,
  pathTipId,
  switchingToEntryId,
  onSelectEntry,
}: {
  entry$: ObservableItem<LinkedChatEntry>;
  branchDepth: number;
  childRowsOf: (parentId: string | null) => ObservableItem<LinkedChatEntry>[];
  sessionStore: ObservableItemCollection<LinkedChatEntry>;
  activePathIds: Set<string>;
  pathTipId: string | null;
  switchingToEntryId: string | null;
  onSelectEntry: (entryId: string) => void;
}) {
  const entry = useObservableValue(entry$);
  const children = childRowsOf(entry.id);
  const siblings = siblingsOf(sessionStore, entry.id);
  const hasSiblings = siblings.length > 1;
  const nextBranchDepth = branchDepth + (hasSiblings ? 1 : 0);
  const isActive = activePathIds.has(entry.id);
  const isLeaf = children.length === 0;
  const isSwitching = switchingToEntryId === entry.id;
  const isUserMessage = entry.type === "user-message";
  const [userExpanded, setUserExpanded] = useState(false);
  const isBranchPoint = hasSiblings && !isActive && children.length > 0;
  const isCollapsedTurn = isUserMessage && !isActive && children.length > 0;
  const isCollapsible = isBranchPoint || isCollapsedTurn;
  const childrenVisible = !isCollapsible || userExpanded;
  const showToggle = isCollapsible;

  return (
    <div className={cn(isUserMessage && branchDepth === 0 && "mt-1.5 first:mt-0")}>
      <div style={{ paddingLeft: `${branchDepth * 10}px` }}>
        <div
          className={cn(
            "flex min-w-0 items-start gap-0.5 py-0.5 text-left transition-colors",
            isActive ? "text-foreground" : "text-muted-foreground",
            isUserMessage && "font-medium",
            !isActive && "hover:bg-secondary/40 hover:text-foreground",
            isSwitching && "cursor-wait opacity-60",
          )}
        >
          {showToggle ? (
            <button
              type="button"
              aria-label={userExpanded ? "Collapse branch" : "Expand branch"}
              onClick={(e) => {
                e.stopPropagation();
                setUserExpanded((v) => !v);
              }}
              className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className={cn("h-3 w-3 transition-transform", userExpanded ? "rotate-90" : "")} />
            </button>
          ) : null}
          <button
            type="button"
            disabled={isSwitching}
            onClick={() => {
              void onSelectEntry(entry.id);
            }}
            className="flex min-w-0 flex-1 items-start gap-1.5 px-1 py-0.5 text-left"
          >
            <span className={cn(isActive ? "text-primary" : "text-muted-foreground")}>{entryIcon(entry)}</span>
            <span className="min-w-0 flex-1 truncate">{entryPreview(entry)}</span>
            {isLeaf && pathTipId === entry.id ? (
              <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-primary">head</span>
            ) : null}
          </button>
        </div>
      </div>
      {childrenVisible
        ? children.map((child$) => (
            <BranchNode
              key={child$.id}
              entry$={child$}
              branchDepth={nextBranchDepth}
              childRowsOf={childRowsOf}
              sessionStore={sessionStore}
              activePathIds={activePathIds}
              pathTipId={pathTipId}
              switchingToEntryId={switchingToEntryId}
              onSelectEntry={onSelectEntry}
            />
          ))
        : null}
    </div>
  );
}
