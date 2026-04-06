import { useCallback, useEffect, useState } from "react";
import { Bot, MessageSquare, MoreVertical, Plus } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { formatRelativeChatTime } from "../utils/formatRelativeChatTime";
import { notifyError } from "../utils/toast";

export type ConversationRow = {
  id: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
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
          setConversations((prev) =>
            prev.map((item) =>
              item.id === ev.conversation.id
                ? {
                    ...item,
                    title: ev.conversation.title,
                    updated_at: ev.conversation.updated_at,
                  }
                : item,
            ),
          );
        }
      },
      pollTick: async () => false,
    });
    return () => dispose();
  }, []);

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
          item.id === updated.id ? { id: updated.id, title: updated.title } : item,
        ),
      );
    } catch (e: unknown) {
      notifyError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <aside className="flex min-h-0 w-full min-w-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Matches frontend2/src/pages/Index.tsx sidebar header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-sidebar-border p-3">
        <Bot className="h-5 w-5 shrink-0 text-primary" aria-hidden />
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Runvane
        </span>
      </div>

      {/* Matches frontend2/src/components/sidebar/ConversationList.tsx structure */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="space-y-2 border-b border-sidebar-border p-3">
          <button
            type="button"
            onClick={onNewChat}
            className="flex w-full items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden />
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

        <div className="scrollbar-thin flex min-h-0 flex-1 flex-col space-y-0.5 overflow-y-auto p-2">
          {conversations.map((c) => {
            const active = activeConversationId === c.id;
            const stamp = formatRelativeChatTime(c.updated_at || c.created_at);
            return (
              <div
                key={c.id}
                className={cn(
                  "group/row flex w-full items-stretch overflow-hidden rounded-md text-sm transition-colors",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 px-3 py-2.5 text-left"
                  onClick={() => onSelect(c.id)}
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare
                      className="h-3.5 w-3.5 shrink-0"
                      aria-hidden
                    />
                    <span className="truncate font-medium">
                      {c.title || "Untitled"}
                    </span>
                  </div>
                  {stamp ? (
                    <span className="ml-5.5 mt-0.5 block truncate text-[10px] text-muted-foreground">
                      {stamp}
                    </span>
                  ) : null}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-auto w-8 shrink-0 rounded-none shadow-none",
                        "text-muted-foreground hover:bg-secondary/80 hover:text-foreground",
                        "opacity-60 group-hover/row:opacity-100",
                        active && "text-foreground opacity-100",
                      )}
                      aria-label="Chat menu"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem
                      onSelect={() => void onRenameConversation(c)}
                    >
                      Rename
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
