import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Plus, FolderInput, Trash2, X } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  createConversation,
  getConversations,
  postConversationMessage,
  renameConversation,
} from "../api/client";
import { subscribeGlobalLive } from "../protocol/runLiveClient";
import { SseType } from "../protocol/sseTypes";
import { notifyError } from "../utils/toast";
import { ConversationItem } from "./conversationSidebar/ConversationItem";
import { ConversationGroupItem } from "./conversationSidebar/ConversationGroupItem";
import type { ConversationGroupRow, ConversationRow } from "./conversationSidebar/types";

type ConversationSidebarProps = {
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
};

const PROBE_MESSAGE = "what is the time?";

export function ConversationSidebar({
  activeConversationId,
  onSelect,
  onNewChat,
}: ConversationSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [groups, setGroups] = useState<ConversationGroupRow[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [selectedConversationIds, setSelectedConversationIds] = useState<string[]>([]);
  const [probeBusy, setProbeBusy] = useState(false);

  const loadConversations = useCallback(async () => {
    const data = await getConversations();
    setConversations(data.conversations);
    setGroups(data.groups);
    return data;
  }, []);

  useEffect(() => {
    void loadConversations();
  }, []);

  useEffect(() => {
    setSelectedConversationIds((prev) =>
      prev.filter((id) => conversations.some((row) => row.id === id)),
    );
  }, [conversations]);

  useEffect(() => {
    const dispose = subscribeGlobalLive({
      onSseEvent: (ev) => {
        if (ev.type === SseType.CONVERSATION_CREATED) {
          setConversations((prev) => {
            if (prev.some((item) => item.id === ev.conversation.id)) return prev;
            return [ev.conversation, ...prev];
          });
          return;
        }
        if (ev.type === SseType.CONVERSATION_UPDATED) {
          setConversations((prev) =>
            prev.map((item) =>
              item.id === ev.conversation.id
                ? {
                    ...item,
                    title: ev.conversation.title,
                    group_id: ev.conversation.group_id,
                    updated_at: ev.conversation.updated_at,
                    prompt_tokens_total: ev.conversation.prompt_tokens_total,
                    completion_tokens_total: ev.conversation.completion_tokens_total,
                    estimated_cost_usd:
                      typeof ev.conversation.estimated_cost_usd === "number" &&
                      Number.isFinite(ev.conversation.estimated_cost_usd)
                        ? ev.conversation.estimated_cost_usd
                        : item.estimated_cost_usd,
                  }
                : item,
            ),
          );
          return;
        }
      },
    });
    return () => dispose();
  }, [loadConversations]);

  async function onProbeTime() {
    if (probeBusy) return;
    setProbeBusy(true);
    try {
      const agentId = searchParams.get("agent")?.trim() || "";
      if (!agentId) {
        notifyError("Select an agent first");
        return;
      }
      const created = await createConversation({
        title: "New chat",
      });
      const id = String(created.id || "").trim();
      if (!id) throw new Error("No conversation id from server");

      await postConversationMessage(id, {
        message: PROBE_MESSAGE,
        agent_id: agentId,
      });

      void loadConversations();
      navigate({
        pathname: `/chat/${encodeURIComponent(id)}`,
        search: location.search,
      });
    } catch (e: unknown) {
      notifyError(e instanceof Error ? e.message : String(e));
    } finally {
      setProbeBusy(false);
    }
  }

  async function onRenameConversation(conversation: ConversationRow) {
    const current = String(conversation.title || "").trim();
    const next = window.prompt("Rename chat", current);
    if (next == null) return;
    const title = next.trim();
    if (!title || title === current) return;
    try {
      const updated = await renameConversation(conversation.id, { title });
      setConversations((prev) =>
        prev.map((item) =>
          item.id === updated.id ? { ...item, ...updated } : item,
        ),
      );
    } catch (e: unknown) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onMoveConversationToGroup(
    conversation: ConversationRow,
    target: { groupId?: string | null; newGroupName?: string },
  ) {
    try {
      await renameConversation(conversation.id, {
        group_id:
          Object.prototype.hasOwnProperty.call(target, "groupId") ? (target.groupId ?? null) : undefined,
        new_group_name:
          Object.prototype.hasOwnProperty.call(target, "newGroupName")
            ? String(target.newGroupName ?? "")
            : undefined,
      });
      const data = await loadConversations();
      const groupId = target.groupId;
      if (typeof groupId === "string" && groupId.trim()) {
        setCollapsedGroups((prev) => ({ ...prev, [groupId]: false }));
      } else if (target.newGroupName) {
        const nextGroup = data.groups.find(
          (group) =>
            group.name.localeCompare(target.newGroupName || "", undefined, { sensitivity: "base" }) === 0,
        );
        if (nextGroup?.id) {
          setCollapsedGroups((prev) => ({ ...prev, [nextGroup.id]: false }));
        }
      }
    } catch (e: unknown) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
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

  function latestSectionTimestamp(rows: ConversationRow[]): { ms: number; raw: string } {
    return rows.reduce(
      (best, row) => {
        const raw = String(row.updated_at || row.created_at || "").trim();
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
      const groupId = String(row.group_id || "").trim();
      if (!groupId) {
        ungrouped.push(row);
        continue;
      }
      const list = byGroupId.get(groupId) ?? [];
      list.push(row);
      byGroupId.set(groupId, list);
    }
    const groupIds = Array.from(byGroupId.keys());
    type SidebarSection =
      | { kind: "conversation"; row: ConversationRow; latestMs: number }
      | {
          kind: "group";
          groupId: string;
          groupName: string;
          rows: ConversationRow[];
          latestMs: number;
        };
    const orderedSections: SidebarSection[] = [
      ...ungrouped.map((row) => ({
        kind: "conversation" as const,
        row,
        latestMs: parseTimestampMs(String(row.updated_at || row.created_at || "")),
      })),
      ...groupIds.map((groupId) => {
        const rows = byGroupId.get(groupId) ?? [];
        const groupName = groupById.get(groupId)?.name ?? "Unnamed group";
        const latestMs = latestSectionTimestamp(rows).ms;
        return {
          kind: "group" as const,
          groupId,
          groupName,
          rows,
          latestMs,
        };
      }),
    ]
      .filter((section) =>
        section.kind === "conversation" ? Boolean(section.row.id) : section.rows.length > 0,
      )
      .sort((a, b) => {
        if (b.latestMs !== a.latestMs) return b.latestMs - a.latestMs;
        if (a.kind === "conversation" && b.kind === "conversation") {
          return String(a.row.title || "").localeCompare(String(b.row.title || ""), undefined, {
            sensitivity: "base",
          });
        }
        if (a.kind === "group" && b.kind === "group") {
          return a.groupName.localeCompare(b.groupName, undefined, { sensitivity: "base" });
        }
        return a.kind === "group" ? -1 : 1;
      });

    return {
      groups: groups.filter((group) => String(group.id || "").trim()),
      orderedSections,
    };
  }, [conversations, groups]);

  const knownGroups = grouped.groups;
  const multiSelectMode = selectedConversationIds.length > 0;

  function onToggleSelected(conversationId: string, checked: boolean) {
    setSelectedConversationIds((prev) => {
      if (checked) {
        if (prev.includes(conversationId)) return prev;
        return [...prev, conversationId];
      }
      return prev.filter((id) => id !== conversationId);
    });
  }

  function renderConversationRow(c: ConversationRow, opts?: { nested?: boolean }) {
    const active = activeConversationId === c.id;
    return (
      <ConversationItem
        key={c.id}
        conversation={c}
        active={active}
        nested={opts?.nested}
        knownGroups={knownGroups}
        multiSelectMode={multiSelectMode}
        selected={selectedConversationIds.includes(c.id)}
        onSelect={onSelect}
        onToggleSelected={onToggleSelected}
        onRenameConversation={onRenameConversation}
        onMoveConversationToGroup={onMoveConversationToGroup}
      />
    );
  }

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar">
      {/* Matches frontend2/src/pages/Index.tsx sidebar header */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-sidebar-border px-2.5 py-2">
        <Bot className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Runvane
        </span>
      </div>

      {/* Matches frontend2/src/components/sidebar/ConversationList.tsx structure */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="space-y-1.5 border-b border-sidebar-border px-2.5 py-2">
          <button
            type="button"
            onClick={onNewChat}
            className="flex w-full items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
            New Chat
          </button>
          <button
            type="button"
            className="w-full rounded-md px-1 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            onClick={() => void onProbeTime()}
            disabled={probeBusy}
          >
            Probe: time (tmp)
          </button>
          {multiSelectMode ? (
            <div className="flex items-center justify-between border-t border-sidebar-border pt-1 text-xs text-muted-foreground">
              <span>{selectedConversationIds.length} selected</span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label="Move selected conversations"
                  title="Move selected conversations (coming soon)"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60"
                  disabled
                >
                  <FolderInput className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Delete selected conversations"
                  title="Delete selected conversations (coming soon)"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-destructive/70"
                  disabled
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Exit multi-select mode"
                  title="Exit multi-select mode"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                  onClick={() => setSelectedConversationIds([])}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="scrollbar-thin flex h-full min-h-0 flex-1 flex-col space-y-0.5 overflow-y-auto overflow-x-hidden overscroll-contain px-1.5 py-1.5">
          {grouped.orderedSections.map((section) => {
            if (section.kind === "conversation") {
              return renderConversationRow(section.row);
            }
            const groupName = section.groupName;
            const groupId = section.groupId;
            const rows = section.rows;
            const collapsed = collapsedGroups[groupId] ?? false;
            return (
              <ConversationGroupItem
                key={groupId}
                groupName={groupName}
                rows={rows}
                latestTimestampIso={latestSectionTimestamp(rows).raw}
                collapsed={collapsed}
                onToggle={() =>
                  setCollapsedGroups((prev) => ({
                    ...prev,
                    [groupId]: !(prev[groupId] ?? false),
                  }))
                }
                renderConversationRow={renderConversationRow}
              />
            );
          })}
        </div>
      </div>
    </aside>
  );
}
