import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import { getConversations, renameConversation } from "../../../api/client";
import { subscribeGlobalLive } from "../../../protocol/runLiveClient";
import { SseType } from "../../../protocol/sseTypes";
import { notifyError } from "../../../utils/toast";
import { Button } from "../../ui/button";
import { ThemeToggle } from "../../ThemeToggle";
import { LlmMetaBadge } from "../LlmMetaBadge";
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
  const [streamRawTitle, setStreamRawTitle] = useState("");
  const [tokenTotals, setTokenTotals] = useState({
    prompt: 0,
    cachedPrompt: 0,
    completion: 0,
  });
  const [estimatedCostUsd, setEstimatedCostUsd] = useState(0);
  const [settingsClickPressed, setSettingsClickPressed] = useState(false);

  async function refreshConversationMetrics(targetConversationId: string) {
    const payload = await getConversations();
    const row = payload.conversations.find((x) => x.id === targetConversationId);
    if (!row) return;
    setTokenTotals({
      prompt: row.prompt_tokens_total,
      cachedPrompt: row.cached_prompt_tokens_total ?? 0,
      completion: row.completion_tokens_total,
    });
    setEstimatedCostUsd(
      row.estimated_cost_usd ?? 0,
    );
  }

  function refreshTitle() {
    if (!conversationId) {
      setTitle("New chat");
      setTokenTotals({ prompt: 0, cachedPrompt: 0, completion: 0 });
      setEstimatedCostUsd(0);
      return () => {};
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await getConversations();
        if (cancelled) return;
        const row = rows.conversations.find((x) => x.id === conversationId);
        setTitle(String(row?.title || "Untitled"));
        setTokenTotals({
          prompt: row?.prompt_tokens_total ?? 0,
          cachedPrompt: row?.cached_prompt_tokens_total ?? 0,
          completion: row?.completion_tokens_total ?? 0,
        });
        setEstimatedCostUsd(row?.estimated_cost_usd ?? 0);
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
    setTokenTotals({ prompt: 0, cachedPrompt: 0, completion: 0 });
    setEstimatedCostUsd(0);
    setStreamRawTitle("");
    return refreshTitle();
  }, [conversationId]);

  useEffect(() => {
    const cid = conversationId;
    if (!cid) return () => {};
    const dispose = subscribeGlobalLive({
      onSseEvent: (ev) => {
        if (ev.conversation_id !== cid) return;
        if (ev.type === SseType.TITLE_STARTING) {
          setStreamRawTitle("");
          return;
        }
        if (ev.type === SseType.TITLE_LLM_STREAM) {
          setStreamRawTitle((prev) => `${prev}${ev.delta}`);
          return;
        }
        if (ev.type === SseType.CONVERSATION_UPDATED) {
          setStreamRawTitle("");
          setTitle(String(ev.conversation.title || "Untitled"));
          setTokenTotals({
            prompt: ev.conversation.prompt_tokens_total,
            cachedPrompt: ev.conversation.cached_prompt_tokens_total ?? 0,
            completion: ev.conversation.completion_tokens_total,
          });
          setEstimatedCostUsd(ev.conversation.estimated_cost_usd ?? 0);
          return;
        }
        if (
          ev.type === SseType.PLANNER_RESPONSE ||
          ev.type === SseType.TITLE_RESPONSE
        ) {
          void refreshConversationMetrics(cid).catch((e) => {
            const detail = e instanceof Error ? e.message : String(e);
            notifyError(`Failed to refresh chat metrics: ${detail}`);
          });
        }
      },
    });
    return () => dispose();
  }, [conversationId]);

  async function onCommit(nextTitle: string) {
    if (!conversationId) return;
    try {
      const updated = await renameConversation(conversationId, { title: nextTitle });
      setStreamRawTitle("");
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
        <div className="flex min-w-0 items-center gap-2">
          <EditableConversationTitle
            title={streamRawTitle || title}
            disabled={!conversationId}
            onCommit={onCommit}
          />
          <LlmMetaBadge
            promptTokens={tokenTotals.prompt}
            cachedPromptTokens={tokenTotals.cachedPrompt}
            completionTokens={tokenTotals.completion}
            showTokenBreakdown
            estimatedCostUsd={estimatedCostUsd}
          />
        </div>
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
