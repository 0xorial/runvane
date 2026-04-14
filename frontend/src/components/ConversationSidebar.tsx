import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, ChevronDown, ChevronRight, Folder, MessageSquare, MoreVertical, Plus } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  createConversation,
  getConversations,
  postConversationMessage,
  renameConversation,
} from "../api/client";
import { subscribeGlobalLive } from "../protocol/runLiveClient";
import { SseType } from "../protocol/sseTypes";
import {
  formatExactChatTime,
  formatRelativeChatTime,
} from "../utils/formatRelativeChatTime";
import { notifyError } from "../utils/toast";
import { LlmMetaBadge } from "./chat/LlmMetaBadge";

export type ConversationRow = {
  id: string;
  title?: string;
  group_name?: string;
  created_at?: string;
  updated_at?: string;
  prompt_tokens_total?: number;
  completion_tokens_total?: number;
  estimated_cost_usd?: number;
};

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
  const [streamedTitles, setStreamedTitles] = useState<Record<string, string>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveDialogConversation, setMoveDialogConversation] = useState<ConversationRow | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [probeBusy, setProbeBusy] = useState(false);

  const loadConversations = useCallback(async () => {
    const data = (await getConversations()) as ConversationRow[];
    setConversations(data);
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

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
          setStreamedTitles((prev) => {
            if (!(ev.conversation.id in prev)) return prev;
            const next = { ...prev };
            delete next[ev.conversation.id];
            return next;
          });
          setConversations((prev) =>
            prev.map((item) =>
              item.id === ev.conversation.id
                ? {
                    ...item,
                    title: ev.conversation.title,
                    group_name: ev.conversation.group_name,
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
        if (ev.type === SseType.TITLE_STARTING) {
          setStreamedTitles((prev) => ({ ...prev, [ev.conversation_id]: "" }));
          return;
        }
        if (ev.type === SseType.TITLE_LLM_STREAM) {
          setStreamedTitles((prev) => ({
            ...prev,
            [ev.conversation_id]: `${prev[ev.conversation_id] ?? ""}${ev.delta}`,
          }));
          return;
        }
        if (
          ev.type === SseType.PLANNER_RESPONSE ||
          ev.type === SseType.TITLE_RESPONSE
        ) {
          void loadConversations().catch((e: unknown) => {
            notifyError(e instanceof Error ? e.message : String(e));
          });
        }
      },
      pollTick: async () => false,
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

  async function onMoveConversationToGroup(conversation: ConversationRow, groupNameRaw: string) {
    const group_name = String(groupNameRaw || "").trim();
    try {
      const updated = await renameConversation(conversation.id, { group_name });
      setConversations((prev) =>
        prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
      );
      if (group_name) {
        setCollapsedGroups((prev) => ({ ...prev, [group_name]: false }));
      }
    } catch (e: unknown) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }

  function openNewGroupDialog(conversation: ConversationRow) {
    setMoveDialogConversation(conversation);
    setNewGroupName("");
    setMoveDialogOpen(true);
  }

  async function submitNewGroupDialog() {
    const conversation = moveDialogConversation;
    if (!conversation) return;
    const groupName = newGroupName.trim();
    if (!groupName) {
      notifyError("Group name is required");
      return;
    }
    await onMoveConversationToGroup(conversation, groupName);
    setMoveDialogOpen(false);
    setMoveDialogConversation(null);
    setNewGroupName("");
  }

  const grouped = useMemo(() => {
    const ungrouped: ConversationRow[] = [];
    const byGroup = new Map<string, ConversationRow[]>();
    for (const row of conversations) {
      const group = String(row.group_name || "").trim();
      if (!group) {
        ungrouped.push(row);
        continue;
      }
      const list = byGroup.get(group) ?? [];
      list.push(row);
      byGroup.set(group, list);
    }
    const latestMs = (rows: ConversationRow[]) =>
      rows.reduce((max, row) => {
        const raw = row.updated_at || row.created_at || "";
        const ms = Date.parse(String(raw));
        return Number.isFinite(ms) ? Math.max(max, ms) : max;
      }, 0);

    const groupNames = Array.from(byGroup.keys());
    type GroupSection =
      | { kind: "ungrouped"; rows: ConversationRow[]; latestMs: number }
      | { kind: "group"; groupName: string; rows: ConversationRow[]; latestMs: number };
    const orderedSections: GroupSection[] = [
      { kind: "ungrouped" as const, rows: ungrouped, latestMs: latestMs(ungrouped) },
      ...groupNames.map((groupName) => {
        const rows = byGroup.get(groupName) ?? [];
        return { kind: "group" as const, groupName, rows, latestMs: latestMs(rows) };
      }),
    ]
      .filter((section) => section.rows.length > 0)
      .sort((a, b) => {
        if (b.latestMs !== a.latestMs) return b.latestMs - a.latestMs;
        if (a.kind === "ungrouped" && b.kind !== "ungrouped") return 1;
        if (b.kind === "ungrouped" && a.kind !== "ungrouped") return -1;
        const aName = a.kind === "group" ? a.groupName : "";
        const bName = b.kind === "group" ? b.groupName : "";
        return aName.localeCompare(bName, undefined, { sensitivity: "base" });
      });

    return {
      ungrouped,
      byGroup,
      groupNames: groupNames.sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      ),
      orderedSections,
    };
  }, [conversations]);

  const knownGroups = grouped.groupNames;

  function renderConversationRow(c: ConversationRow, opts?: { nested?: boolean }) {
    const nested = opts?.nested === true;
    const active = activeConversationId === c.id;
    const timestampIso = c.updated_at || c.created_at;
    const stamp = formatRelativeChatTime(timestampIso);
    const stampExact = formatExactChatTime(timestampIso);
    const liveTitle = streamedTitles[c.id] ?? "";
    const promptTokens = Number(c.prompt_tokens_total ?? 0);
    const completionTokens = Number(c.completion_tokens_total ?? 0);
    const estimatedCostUsd = Number(c.estimated_cost_usd ?? 0);
    return (
      <div
        key={c.id}
        className={cn(
          "group/row flex w-full shrink-0 items-stretch overflow-hidden rounded-md text-xs transition-colors",
          active
            ? "bg-secondary text-foreground"
            : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
        )}
      >
        <button
          type="button"
          className={cn("min-w-0 flex-1 px-2.5 py-2 text-left", nested && "pl-6")}
          onClick={() => onSelect(c.id)}
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate font-medium">
              {liveTitle || c.title || "Untitled"}
            </span>
          </div>
          {stamp ? (
            <span
              className="ml-5.5 mt-0.5 block truncate text-[10px] text-muted-foreground"
              title={stampExact}
            >
              {stamp}
            </span>
          ) : null}
          <LlmMetaBadge
            promptTokens={promptTokens}
            completionTokens={completionTokens}
            showTokenBreakdown
            estimatedCostUsd={estimatedCostUsd}
            className="ml-5.5 mt-0.5 bg-transparent px-0 py-0 text-[10px]"
          />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "h-auto w-7 shrink-0 rounded-none shadow-none",
                "text-muted-foreground hover:bg-secondary/80 hover:text-foreground",
                "opacity-60 group-hover/row:opacity-100",
                active && "text-foreground opacity-100",
              )}
              aria-label="Chat menu"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => void onRenameConversation(c)}>
              Rename
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to group</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-52">
                <DropdownMenuItem onSelect={() => void onMoveConversationToGroup(c, "")}>
                  No group
                </DropdownMenuItem>
                {knownGroups.map((groupName) => (
                  <DropdownMenuItem
                    key={groupName}
                    onSelect={() => void onMoveConversationToGroup(c, groupName)}
                  >
                    {groupName}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onSelect={() => openNewGroupDialog(c)}>
                  New group...
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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
        </div>

        <div className="scrollbar-thin flex h-full min-h-0 flex-1 flex-col space-y-0.5 overflow-y-auto overflow-x-hidden overscroll-contain px-1.5 py-1.5">
          {/* USER_INVARIANT[RV-015]: Conversations support groups with collapsible folder sections and move-to-group actions. */}
          {grouped.orderedSections.map((section) => {
            if (section.kind === "ungrouped") {
              return (
                <div key="ungrouped-section" className="flex flex-col gap-0.5">
                  {section.rows.map((c) => renderConversationRow(c))}
                </div>
              );
            }
            const groupName = section.groupName;
            const rows = section.rows;
            const collapsed = collapsedGroups[groupName] ?? false;
            return (
              <div key={groupName} className="pt-1">
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                  onClick={() =>
                    setCollapsedGroups((prev) => ({
                      ...prev,
                      [groupName]: !(prev[groupName] ?? false),
                    }))
                  }
                >
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    {collapsed ? (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    )}
                    <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{groupName}</span>
                  </span>
                  <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">
                    {rows.length}
                  </span>
                </button>
                {collapsed ? null : (
                  <div className="mt-0.5 flex flex-col gap-0.5">
                    {rows.map((c) => renderConversationRow(c, { nested: true }))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <Dialog
        open={moveDialogOpen}
        onOpenChange={(open) => {
          setMoveDialogOpen(open);
          if (!open) {
            setMoveDialogConversation(null);
            setNewGroupName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
            <DialogDescription>
              Move this conversation to a new group.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="new-conversation-group">
              Group name
            </label>
            <input
              id="new-conversation-group"
              className="box-border min-h-[34px] w-full rounded-md border border-input bg-background px-3 text-sm"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitNewGroupDialog();
                }
              }}
              placeholder="e.g. Work"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMoveDialogOpen(false);
                setMoveDialogConversation(null);
                setNewGroupName("");
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void submitNewGroupDialog()}>
              Create group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
