import { useEffect, useMemo, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, Settings, Square } from "lucide-react";
import {
  cancelConversationProcessing,
  getConversations,
  getModelCapabilities,
  renameConversation,
} from "../../../api/client";
import { subscribeGlobalLive } from "../../../protocol/runLiveClient";
import { SseType } from "../../../protocol/sseTypes";
import { notifyError } from "../../../utils/toast";
import { Button } from "../../ui/button";
import { ThemeToggle } from "../../ThemeToggle";
import { LlmMetaBadge } from "../LlmMetaBadge";
import { EditableConversationTitle } from "./EditableConversationTitle";
import {
  buildModelPricingByName,
  estimateConversationCostUsd,
  type ModelPricing,
  type TokenUsageByModelRow,
} from "@/lib/costEstimation";

type ChatTitlePanelProps = {
  conversationId: string | null;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  settingsPressed?: boolean;
};

function timestampMs(value: string | undefined): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

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
  const [tokenUsageByModel, setTokenUsageByModel] = useState<TokenUsageByModelRow[]>([]);
  const [pricingByModel, setPricingByModel] = useState<Map<string, ModelPricing>>(() => new Map());
  const [conversationUpdatedAt, setConversationUpdatedAt] = useState<string>("");
  const [settingsClickPressed, setSettingsClickPressed] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const estimatedCostUsd = useMemo(
    () => estimateConversationCostUsd(tokenUsageByModel, pricingByModel),
    [tokenUsageByModel, pricingByModel],
  );

  async function refreshConversationMetrics(targetConversationId: string) {
    const payload = await getConversations();
    const row = payload.conversations.find((x) => x.id === targetConversationId);
    if (!row) return;
    setTokenTotals({
      prompt: row.prompt_tokens_total,
      cachedPrompt: row.cached_prompt_tokens_total ?? 0,
      completion: row.completion_tokens_total,
    });
    setTokenUsageByModel(row.token_usage_by_model ?? []);
    setConversationUpdatedAt(String(row.updated_at ?? ""));
  }

  function refreshTitle() {
    if (!conversationId) {
      setTitle("New chat");
      setTokenTotals({ prompt: 0, cachedPrompt: 0, completion: 0 });
      setTokenUsageByModel([]);
      setConversationUpdatedAt("");
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
        setTokenUsageByModel(row?.token_usage_by_model ?? []);
        setConversationUpdatedAt(String(row?.updated_at ?? ""));
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
    setTokenUsageByModel([]);
    setConversationUpdatedAt("");
    setStreamRawTitle("");
    return refreshTitle();
  }, [conversationId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await getModelCapabilities();
        if (cancelled) return;
        setPricingByModel(buildModelPricingByName(data.models));
      } catch (e) {
        if (cancelled) return;
        const detail = e instanceof Error ? e.message : String(e);
        notifyError(`Failed to load model pricing: ${detail}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
          const currentMs = timestampMs(conversationUpdatedAt);
          const incomingMs = timestampMs(ev.conversation.updated_at);
          if (currentMs != null && incomingMs != null && incomingMs < currentMs) {
            return;
          }
          setStreamRawTitle("");
          setTitle(String(ev.conversation.title || "Untitled"));
          setTokenTotals({
            prompt: ev.conversation.prompt_tokens_total,
            cachedPrompt: ev.conversation.cached_prompt_tokens_total ?? 0,
            completion: ev.conversation.completion_tokens_total,
          });
          setTokenUsageByModel(ev.conversation.token_usage_by_model ?? []);
          setConversationUpdatedAt(String(ev.conversation.updated_at ?? ""));
          return;
        }
        if (ev.type === SseType.PLANNER_RESPONSE || ev.type === SseType.TITLE_RESPONSE) {
          void refreshConversationMetrics(cid).catch((e) => {
            const detail = e instanceof Error ? e.message : String(e);
            notifyError(`Failed to refresh chat metrics: ${detail}`);
          });
        }
      },
    });
    return () => dispose();
  }, [conversationId, conversationUpdatedAt]);

  async function onCommit(nextTitle: string) {
    if (!conversationId) return;
    try {
      const updated = await renameConversation(conversationId, {
        title: nextTitle,
      });
      setStreamRawTitle("");
      setTitle(String(updated.title || nextTitle));
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      notifyError(`Failed to rename chat: ${detail}`);
      throw e;
    }
  }

  async function onCancelProcessing(): Promise<void> {
    if (!conversationId || isCancelling) return;
    setIsCancelling(true);
    try {
      await cancelConversationProcessing(conversationId);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      notifyError(`Failed to cancel processing: ${detail}`);
    } finally {
      setIsCancelling(false);
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
        {sidebarVisible ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
      </Button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <EditableConversationTitle title={streamRawTitle || title} disabled={!conversationId} onCommit={onCommit} />
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={!conversationId || isCancelling}
          className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-50"
          onClick={() => {
            void onCancelProcessing();
          }}
          aria-label="Cancel processing"
          title="Cancel processing"
        >
          <Square className="h-3.5 w-3.5" />
        </Button>
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
          <Settings className={settingsPressed ? "h-3.5 w-3.5 text-foreground" : "h-3.5 w-3.5"} />
        </Button>
      </div>
    </div>
  );
}
