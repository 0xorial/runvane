import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  createConversation,
  permanentlyDeleteConversation,
  postConversationMessage,
  renameConversation,
  softDeleteConversation,
  undeleteConversation,
} from "../api/client";
import {
  mergeSseConversation,
  patchConversationsList,
  refreshConversations,
  upsertConversationInList,
  useConversationsQuery,
} from "../hooks/queries/conversations";
import { subscribeGlobalLive } from "../protocol/runLiveClient";
import { SseType } from "../protocol/sseTypes";
import { notifyError } from "../utils/toast";
import { ConversationSidebarList } from "./conversationSidebar/ConversationSidebarList";
import type { SidebarSection } from "./conversationSidebar/ConversationSidebarSections";
import { VirtualizedConversationSidebarSections } from "./conversationSidebar/VirtualizedConversationSidebarSections";
import { MultiSelectPanel } from "./conversationSidebar/MultiSelectPanel";
import type { ConversationGroupRow, ConversationRow } from "./conversationSidebar/types";
import { usePricingMap } from "../hooks/usePricingMap";
import { getChatSessionStore, retainChatSessionLive } from "@/lib/chatSessionRegistry";

type ConversationSidebarProps = {
  onSelect: (id: string) => void;
  onNewChat: () => void;
};

const PROBE_MESSAGE = "what is the time?";
const EMPTY_CONVERSATIONS: ConversationRow[] = [];
const EMPTY_GROUPS: ConversationGroupRow[] = [];

function timestampMs(value: string | undefined): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function ConversationSidebarImpl({ onSelect, onNewChat }: ConversationSidebarProps) {
  const navigate = useNavigate();
  const [showDeletedOnly, setShowDeletedOnly] = useState(false);
  const conversationsQuery = useConversationsQuery(showDeletedOnly);
  const conversations = conversationsQuery.data?.conversations ?? EMPTY_CONVERSATIONS;
  const groups = conversationsQuery.data?.groups ?? EMPTY_GROUPS;
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [selectedConversationIds, setSelectedConversationIds] = useState<string[]>([]);
  const [probeBusy, setProbeBusy] = useState(false);
  const pricingByModel = usePricingMap();

  useEffect(() => {
    setSelectedConversationIds([]);
  }, [showDeletedOnly]);

  useEffect(() => {
    setSelectedConversationIds((prev) => {
      const next = prev.filter((id) => conversations.some((row) => row.id === id));
      if (next.length === prev.length && next.every((id, index) => id === prev[index])) {
        return prev;
      }
      return next;
    });
  }, [conversations]);

  useEffect(() => {
    const dispose = subscribeGlobalLive({
      onSseEvent: (ev) => {
        if (ev.type === SseType.CONVERSATION_CREATED) {
          if (showDeletedOnly || ev.conversation.isDeleted) return;
          patchConversationsList(showDeletedOnly, (prev) => {
            if (prev.conversations.some((item) => item.id === ev.conversation.id)) return prev;
            return {
              ...prev,
              conversations: [mergeSseConversation(undefined, ev.conversation), ...prev.conversations],
            };
          });
          return;
        }
        if (ev.type === SseType.CONVERSATION_UPDATED) {
          const shouldShow = showDeletedOnly ? ev.conversation.isDeleted : !ev.conversation.isDeleted;
          patchConversationsList(showDeletedOnly, (prev) => {
            const index = prev.conversations.findIndex((item) => item.id === ev.conversation.id);
            if (!shouldShow) {
              if (index === -1) return prev;
              const next = prev.conversations.slice();
              next.splice(index, 1);
              return { ...prev, conversations: next };
            }
            if (index === -1) {
              return {
                ...prev,
                conversations: [mergeSseConversation(undefined, ev.conversation), ...prev.conversations],
              };
            }
            const next = prev.conversations.slice();
            const currentMs = timestampMs(next[index].updatedAt);
            const incomingMs = timestampMs(ev.conversation.updatedAt);
            if (currentMs != null && incomingMs != null && incomingMs < currentMs) {
              return prev;
            }
            next[index] = mergeSseConversation(next[index], ev.conversation);
            return { ...prev, conversations: next };
          });
          return;
        }
      },
    });
    return () => dispose();
  }, [showDeletedOnly]);

  async function onProbeTime() {
    if (probeBusy) return;
    setProbeBusy(true);
    try {
      const agentId = new URLSearchParams(window.location.search).get("agent")?.trim() || "";
      if (!agentId) {
        notifyError("Select an agent first");
        return;
      }
      const created = await createConversation({
        title: "New chat",
      });
      const id = String(created.id || "").trim();
      if (!id) throw new Error("No conversation id from server");

      retainChatSessionLive();
      getChatSessionStore(id);

      await postConversationMessage(id, {
        message: PROBE_MESSAGE,
        agentId,
      });

      navigate(
        {
          pathname: `/chat/${encodeURIComponent(id)}`,
          search: window.location.search,
        },
        { replace: true },
      );
    } catch (e: unknown) {
      notifyError(e instanceof Error ? e.message : String(e));
    } finally {
      setProbeBusy(false);
    }
  }

  const onRenameConversation = useCallback(async (conversation: ConversationRow) => {
    const current = String(conversation.title || "").trim();
    const next = window.prompt("Rename chat", current);
    if (next == null) return;
    const title = next.trim();
    if (!title || title === current) return;
    try {
      const updated = await renameConversation(conversation.id, { title });
      upsertConversationInList(showDeletedOnly, updated);
    } catch (e: unknown) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }, [showDeletedOnly]);

  const onMoveConversationToGroup = useCallback(async (
    conversation: ConversationRow,
    target: { groupId?: string | null; newGroupName?: string },
  ) => {
    try {
      await renameConversation(conversation.id, {
        groupId: Object.prototype.hasOwnProperty.call(target, "groupId") ? (target.groupId ?? null) : undefined,
        newGroupName: Object.prototype.hasOwnProperty.call(target, "newGroupName")
          ? String(target.newGroupName ?? "")
          : undefined,
      });
      const data = await refreshConversations(showDeletedOnly);
      const groupId = target.groupId;
      if (typeof groupId === "string" && groupId.trim()) {
        setCollapsedGroups((prev) => ({ ...prev, [groupId]: false }));
      } else if (target.newGroupName) {
        const nextGroup = data.groups.find(
          (group) =>
            group.name.localeCompare(target.newGroupName || "", undefined, {
              sensitivity: "base",
            }) === 0,
        );
        if (nextGroup?.id) {
          setCollapsedGroups((prev) => ({ ...prev, [nextGroup.id]: false }));
        }
      }
    } catch (e: unknown) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }, [showDeletedOnly]);

  // Functional updater reads the latest selection and returns the same array
  // when nothing changes, so these handlers stay stable (deps: showDeletedOnly).
  const deselect = useCallback((id: string) => {
    setSelectedConversationIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev));
  }, []);

  const onSoftDeleteConversation = useCallback(async (conversation: ConversationRow) => {
    try {
      await softDeleteConversation(conversation.id);
      await refreshConversations(showDeletedOnly);
      deselect(conversation.id);
    } catch (e: unknown) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }, [showDeletedOnly, deselect]);

  const onUndeleteConversation = useCallback(async (conversation: ConversationRow) => {
    try {
      await undeleteConversation(conversation.id);
      await refreshConversations(showDeletedOnly);
      deselect(conversation.id);
    } catch (e: unknown) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }, [showDeletedOnly, deselect]);

  const onPermanentlyDeleteConversation = useCallback(async (conversation: ConversationRow) => {
    const confirmed = window.confirm("Delete this conversation permanently? This action is irreversible.");
    if (!confirmed) return;
    try {
      await permanentlyDeleteConversation(conversation.id);
      await refreshConversations(showDeletedOnly);
      deselect(conversation.id);
    } catch (e: unknown) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }, [showDeletedOnly, deselect]);

  async function onDeleteSelectedConversations() {
    const selectedIds = selectedConversationIds;
    if (selectedIds.length === 0) return;
    const confirmed = window.confirm(
      showDeletedOnly
        ? "Delete selected conversations permanently? This action is irreversible."
        : `Delete ${selectedIds.length} selected conversation(s)?`,
    );
    if (!confirmed) return;
    const deletionFn = showDeletedOnly ? permanentlyDeleteConversation : softDeleteConversation;
    const results = await Promise.allSettled(selectedIds.map((id) => deletionFn(id)));
    const failedIds: string[] = [];
    let firstReason = "";
    results.forEach((result, index) => {
      if (result.status === "fulfilled") return;
      failedIds.push(selectedIds[index]);
      if (!firstReason) {
        firstReason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      }
    });
    await refreshConversations(showDeletedOnly);
    if (failedIds.length > 0) {
      setSelectedConversationIds(failedIds);
      notifyError(`Deleted ${selectedIds.length - failedIds.length}/${selectedIds.length}. ${firstReason}`);
      return;
    }
    setSelectedConversationIds([]);
  }

  function parseTimestampMs(rawValue: string | undefined): number {
    const raw = String(rawValue || "").trim();
    if (!raw) throw new Error("missing conversation timestamp");
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) {
      throw new Error(`invalid conversation timestamp: ${raw}`);
    }
    return ms;
  }

  function latestSectionTimestamp(rows: ConversationRow[]): {
    ms: number;
    raw: string;
  } {
    return rows.reduce(
      (best, row) => {
        const raw = String(row.lastMessageAt || row.createdAt || row.updatedAt || "").trim();
        const ms = parseTimestampMs(raw);
        return ms > best.ms ? { ms, raw } : best;
      },
      { ms: Number.NEGATIVE_INFINITY, raw: "" },
    );
  }

  const grouped = useMemo(() => {
    const ungrouped: ConversationRow[] = [];
    const byGroupId = new Map<string, ConversationRow[]>();
    const groupById = new Map<string, ConversationGroupRow>();
    for (const group of groups) {
      const id = String(group.id || "").trim();
      if (!id) continue;
      groupById.set(id, group);
    }
    for (const row of conversations) {
      const groupId = String(row.groupId || "").trim();
      if (!groupId) {
        ungrouped.push(row);
        continue;
      }
      const list = byGroupId.get(groupId) ?? [];
      list.push(row);
      byGroupId.set(groupId, list);
    }
    const groupIds = Array.from(byGroupId.keys());
    const orderedSections: SidebarSection[] = [
      ...ungrouped.map((row) => ({
        kind: "conversation" as const,
        row,
        latestMs: parseTimestampMs(String(row.lastMessageAt || row.createdAt || row.updatedAt || "")),
      })),
      ...groupIds.map((groupId) => {
        const rows = byGroupId.get(groupId) ?? [];
        const groupName = groupById.get(groupId)?.name ?? "Unnamed group";
        const latest = latestSectionTimestamp(rows);
        return {
          kind: "group" as const,
          groupId,
          groupName,
          rows,
          latestMs: latest.ms,
          latestTimestampIso: latest.raw,
        };
      }),
    ]
      .filter((section) => (section.kind === "conversation" ? Boolean(section.row.id) : section.rows.length > 0))
      .sort((a, b) => {
        if (b.latestMs !== a.latestMs) return b.latestMs - a.latestMs;
        if (a.kind === "conversation" && b.kind === "conversation") {
          return String(a.row.title || "").localeCompare(String(b.row.title || ""), undefined, {
            sensitivity: "base",
          });
        }
        if (a.kind === "group" && b.kind === "group") {
          return a.groupName.localeCompare(b.groupName, undefined, {
            sensitivity: "base",
          });
        }
        return a.kind === "group" ? -1 : 1;
      });

    return { orderedSections };
  }, [conversations, groups]);

  // Derived from `groups` alone so its identity is stable across conversation
  // patches (token updates during a run) — otherwise every memoized row would
  // see a new `knownGroups` prop and re-render.
  const knownGroups = useMemo(
    () => groups.filter((group) => String(group.id || "").trim()),
    [groups],
  );
  const multiSelectMode = selectedConversationIds.length > 0;

  const onToggleSelected = useCallback((conversationId: string, checked: boolean) => {
    setSelectedConversationIds((prev) => {
      if (checked) {
        if (prev.includes(conversationId)) return prev;
        return [...prev, conversationId];
      }
      return prev.filter((id) => id !== conversationId);
    });
  }, []);

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !(prev[groupId] ?? false) }));
  }, []);

  const sectionListProps = useMemo(
    () => ({
      orderedSections: grouped.orderedSections,
      collapsedGroups,
      knownGroups,
      multiSelectMode,
      deletedMode: showDeletedOnly,
      pricingByModel,
      selectedConversationIds,
      onSelect,
      onToggleSelected,
      onRenameConversation,
      onMoveConversationToGroup,
      onSoftDeleteConversation,
      onUndeleteConversation,
      onPermanentlyDeleteConversation,
      onToggleGroup: toggleGroup,
    }),
    [
      grouped.orderedSections,
      collapsedGroups,
      knownGroups,
      multiSelectMode,
      showDeletedOnly,
      pricingByModel,
      selectedConversationIds,
      onSelect,
      onToggleSelected,
      onRenameConversation,
      onMoveConversationToGroup,
      onSoftDeleteConversation,
      onUndeleteConversation,
      onPermanentlyDeleteConversation,
      toggleGroup,
    ],
  );

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar">
      {/* Matches frontend2/src/pages/Index.tsx sidebar header */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-sidebar-border px-2.5 py-2">
        <Bot className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span className="text-sm font-semibold tracking-tight text-foreground">Runvane</span>
      </div>

      {/* Matches frontend2/src/components/sidebar/ConversationList.tsx structure */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="space-y-1.5 border-b border-sidebar-border px-2.5 py-2">
          <button
            type="button"
            data-testid="sidebar-new-chat"
            onClick={onNewChat}
            className="flex w-full items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
            New Chat
          </button>
          <button
            type="button"
            data-testid="sidebar-probe-time"
            className="w-full rounded-md px-1 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            onClick={() => void onProbeTime()}
            disabled={probeBusy}
          >
            Probe: time (tmp)
          </button>
          <button
            type="button"
            className="w-full rounded-md px-1 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowDeletedOnly((prev) => !prev)}
          >
            {showDeletedOnly ? "Show active" : "Show deleted"}
          </button>
          {multiSelectMode ? (
            <MultiSelectPanel
              selectedConversationIds={selectedConversationIds}
              knownGroups={knownGroups}
              deletedMode={showDeletedOnly}
              reloadConversations={async () => {
                const data = await refreshConversations(showDeletedOnly);
                return { groups: data.groups };
              }}
              onSelectionChange={setSelectedConversationIds}
              onExpandGroup={(groupId) => setCollapsedGroups((prev) => ({ ...prev, [groupId]: false }))}
              onDeleteSelected={onDeleteSelectedConversations}
            />
          ) : null}
        </div>

        <ConversationSidebarList>
          <VirtualizedConversationSidebarSections {...sectionListProps} />
        </ConversationSidebarList>
      </div>
    </aside>
  );
}

function sidebarPropsAreEqual(prev: ConversationSidebarProps, next: ConversationSidebarProps): boolean {
  return prev.onSelect === next.onSelect && prev.onNewChat === next.onNewChat;
}

export const ConversationSidebar = memo(ConversationSidebarImpl, sidebarPropsAreEqual);
