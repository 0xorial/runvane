import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Brain, Dot, GitBranch, User, Wrench } from "lucide-react";
import { getConversationMessages, setConversationActiveLeaf } from "@/api/client";
import type { ChatEntry } from "@/protocol/chatEntry";
import { notifyError } from "@/utils/toast";
import { cn } from "@/lib/utils";

type ConversationBranchesPanelProps = {
  conversationId: string | null;
  activePathEntries: ChatEntry[];
};

function entryPreview(entry: ChatEntry): string {
  if (entry.type === "user-message" || entry.type === "assistant-message") {
    const text = entry.text.trim();
    return text.length > 0 ? text : "(empty message)";
  }
  if (entry.type === "tool-invocation") {
    return `Tool: ${entry.toolId || "unknown"}`;
  }
  const status = String(entry.status || "running").trim();
  const promptTokens = typeof entry.promptTokens === "number" && Number.isFinite(entry.promptTokens) ? entry.promptTokens : 0;
  const cachedPromptTokens =
    typeof entry.cachedPromptTokens === "number" && Number.isFinite(entry.cachedPromptTokens) ? entry.cachedPromptTokens : 0;
  const completionTokens =
    typeof entry.completionTokens === "number" && Number.isFinite(entry.completionTokens) ? entry.completionTokens : 0;
  const totalTokens = promptTokens + cachedPromptTokens + completionTokens;
  const tokenLabel = totalTokens > 0 ? `${totalTokens} tok` : "";
  const model = String(entry.llmModel || "").trim();
  const meta = [model, tokenLabel].filter((x) => x.length > 0).join(" · ");
  return meta ? `${status} · ${meta}` : status;
}

function entryIcon(entry: ChatEntry) {
  if (entry.type === "user-message") return <User className="mt-0.5 h-3 w-3 shrink-0" />;
  if (entry.type === "assistant-message") return <Bot className="mt-0.5 h-3 w-3 shrink-0" />;
  if (entry.type === "tool-invocation") return <Wrench className="mt-0.5 h-3 w-3 shrink-0" />;
  if (entry.type === "planner_llm_stream" || entry.type === "title_llm_stream") {
    return <Brain className="mt-0.5 h-3 w-3 shrink-0" />;
  }
  return <Dot className="mt-0.5 h-3 w-3 shrink-0" />;
}

function byConversationIndexAsc(a: ChatEntry, b: ChatEntry): number {
  if (a.conversationIndex !== b.conversationIndex) return a.conversationIndex - b.conversationIndex;
  return a.createdAt.localeCompare(b.createdAt);
}

function deepestDescendantId(entryId: string, childrenByParent: Map<string | null, ChatEntry[]>): string {
  let cursor = entryId;
  for (;;) {
    const children = childrenByParent.get(cursor) ?? [];
    if (children.length === 0) return cursor;
    cursor = children[children.length - 1].id;
  }
}

export function ConversationBranchesPanel({ conversationId, activePathEntries }: ConversationBranchesPanelProps) {
  const [allEntries, setAllEntries] = useState<ChatEntry[]>([]);
  const [switchingToEntryId, setSwitchingToEntryId] = useState<string | null>(null);

  const activePathIds = useMemo(() => new Set(activePathEntries.map((entry) => entry.id)), [activePathEntries]);
  const activeLeafId = activePathEntries[activePathEntries.length - 1]?.id ?? null;
  const activePathSignature = useMemo(() => activePathEntries.map((entry) => entry.id).join("|"), [activePathEntries]);

  const reloadAllEntries = useCallback(async () => {
    if (!conversationId) {
      setAllEntries([]);
      return;
    }
    const rows = await getConversationMessages(conversationId, { all: true });
    rows.sort(byConversationIndexAsc);
    setAllEntries(rows);
  }, [conversationId]);

  useEffect(() => {
    void reloadAllEntries().catch((e) => {
      const detail = e instanceof Error ? e.message : String(e);
      notifyError(`Failed to load conversation branches: ${detail}`);
    });
  }, [reloadAllEntries, activePathSignature]);

  const entriesById = useMemo(() => new Map(allEntries.map((entry) => [entry.id, entry])), [allEntries]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, ChatEntry[]>();
    for (const entry of allEntries) {
      const parentId = entry.parentId;
      if (parentId && !entriesById.has(parentId)) {
        const roots = map.get(null) ?? [];
        roots.push(entry);
        map.set(null, roots);
        continue;
      }
      const list = map.get(parentId) ?? [];
      list.push(entry);
      map.set(parentId, list);
    }
    for (const list of map.values()) {
      list.sort(byConversationIndexAsc);
    }
    return map;
  }, [allEntries, entriesById]);

  const rootNodes = childrenByParent.get(null) ?? [];

  async function handleSelectEntry(entryId: string) {
    if (!conversationId) return;
    const targetLeafId = deepestDescendantId(entryId, childrenByParent);
    if (!targetLeafId) return;
    setSwitchingToEntryId(targetLeafId);
    try {
      await setConversationActiveLeaf(conversationId, targetLeafId);
      window.dispatchEvent(new Event("runvane:refresh-chat"));
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
        <GitBranch className="h-4 w-4 text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Branches</h3>
      </div>
      <div className="text-[11px]">
        {rootNodes.map((entry) => (
          <BranchNode
            key={entry.id}
            entry={entry}
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
  entry,
  branchDepth,
  childrenByParent,
  activePathIds,
  activeLeafId,
  switchingToEntryId,
  onSelectEntry,
}: {
  entry: ChatEntry;
  branchDepth: number;
  childrenByParent: Map<string | null, ChatEntry[]>;
  activePathIds: Set<string>;
  activeLeafId: string | null;
  switchingToEntryId: string | null;
  onSelectEntry: (entryId: string) => void;
}) {
  const children = childrenByParent.get(entry.id) ?? [];
  const siblings = childrenByParent.get(entry.parentId) ?? [];
  const hasSiblings = siblings.length > 1;
  const nextBranchDepth = branchDepth + (hasSiblings ? 1 : 0);
  const isActive = activePathIds.has(entry.id);
  const isLeaf = children.length === 0;
  const isSwitching = switchingToEntryId === entry.id;

  return (
    <div>
      <button
        type="button"
        disabled={isSwitching}
        onClick={() => {
          void onSelectEntry(entry.id);
        }}
        className={cn(
          "flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left transition-colors",
          isActive
            ? "bg-primary/10 text-foreground"
            : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
          isSwitching && "cursor-wait opacity-60",
        )}
        style={{ paddingLeft: `${branchDepth * 12 + 6}px` }}
      >
        <span className={cn(isActive ? "text-primary" : "text-muted-foreground")}>{entryIcon(entry)}</span>
        <span className="flex-1 truncate">{entryPreview(entry)}</span>
        {isLeaf && activeLeafId === entry.id ? (
          <span className="text-[9px] font-semibold uppercase tracking-wider text-primary">head</span>
        ) : null}
      </button>
      {children.map((child) => (
        <BranchNode
          key={child.id}
          entry={child}
          branchDepth={nextBranchDepth}
          childrenByParent={childrenByParent}
          activePathIds={activePathIds}
          activeLeafId={activeLeafId}
          switchingToEntryId={switchingToEntryId}
          onSelectEntry={onSelectEntry}
        />
      ))}
    </div>
  );
}
