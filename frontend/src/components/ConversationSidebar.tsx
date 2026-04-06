import { useCallback, useEffect, useState } from "react";
import { MoreVertical } from "lucide-react";
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
    <aside className="flex min-h-0 w-full min-w-0 flex-col gap-2 border-r border-sidebar-border bg-sidebar p-3">
      <Button
        type="button"
        variant="outline"
        className="w-full border-primary/25 bg-primary/10 font-semibold text-primary hover:bg-primary/20"
        onClick={onNewChat}
      >
        + New chat
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full text-xs"
        onClick={() => void onProbeTime()}
        disabled={probeBusy}
      >
        Probe: time (tmp)
      </Button>
      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-0.5">
        {conversations.map((c) => {
          const active = activeConversationId === c.id;
          return (
            <div
              key={c.id}
              className={cn(
                "flex items-center rounded-md border border-transparent transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/60",
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate px-3 py-2.5 text-left text-sm font-medium"
                onClick={() => onSelect(c.id)}
              >
                {c.title || "Untitled"}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground"
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
    </aside>
  );
}
