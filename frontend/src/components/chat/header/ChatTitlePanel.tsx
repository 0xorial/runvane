import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import { getConversations, renameConversation } from "../../../api/client";
import { notifyError } from "../../../utils/toast";
import { Button } from "../../ui/button";
import { ThemeToggle } from "../../ThemeToggle";
import { EditableConversationTitle } from "./EditableConversationTitle";

type ChatTitlePanelProps = {
  conversationId: string | null;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  settingsPressed?: boolean;
};

export function ChatTitlePanel({
  conversationId,
  sidebarVisible,
  onToggleSidebar,
  onOpenSettings,
  settingsPressed = false,
}: ChatTitlePanelProps) {
  const [title, setTitle] = useState("New chat");
  const [settingsClickPressed, setSettingsClickPressed] = useState(false);

  function refreshTitle() {
    if (!conversationId) {
      setTitle("New chat");
      return () => {};
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await getConversations();
        if (cancelled) return;
        const row = rows.find((x) => x.id === conversationId);
        setTitle(String(row?.title || "Untitled"));
      } catch (e) {
        if (cancelled) return;
        const detail = e instanceof Error ? e.message : String(e);
        notifyError(`Failed to load chat title: ${detail}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }

  useEffect(() => {
    return refreshTitle();
  }, [conversationId]);

  async function onCommit(nextTitle: string) {
    if (!conversationId) return;
    try {
      const updated = await renameConversation(conversationId, { title: nextTitle });
      setTitle(String(updated.title || nextTitle));
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      notifyError(`Failed to rename chat: ${detail}`);
      throw e;
    }
  }

  return (
    <div className="relative z-10 flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card/40 px-3">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-foreground"
        onClick={onToggleSidebar}
        aria-label={sidebarVisible ? "Hide chat sidebar" : "Show chat sidebar"}
        title={sidebarVisible ? "Hide chats" : "Show chats"}
      >
        {sidebarVisible ? (
          <PanelLeftClose className="h-3.5 w-3.5" />
        ) : (
          <PanelLeftOpen className="h-3.5 w-3.5" />
        )}
      </Button>
      <div className="min-w-0 flex-1">
        <EditableConversationTitle
          title={title}
          disabled={!conversationId}
          onCommit={onCommit}
        />
      </div>
      <div className="flex items-center gap-0.5">
        <ThemeToggle />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={
            settingsPressed || settingsClickPressed
              ? "h-7 w-7 bg-muted text-foreground hover:bg-muted"
              : "h-7 w-7 text-muted-foreground hover:text-foreground"
          }
          onClick={() => {
            setSettingsClickPressed(true);
            onOpenSettings();
          }}
          aria-pressed={settingsPressed || settingsClickPressed}
          aria-label="Open settings"
          title="Settings"
        >
          <Settings
            className={settingsPressed ? "h-3.5 w-3.5 text-foreground" : "h-3.5 w-3.5"}
          />
        </Button>
      </div>
    </div>
  );
}
