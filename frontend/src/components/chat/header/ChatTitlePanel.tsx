import { useEffect, useMemo, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Settings, Square } from "lucide-react";
import {
  cancelConversationProcessing,
  getConversation,
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
import type { EntryTokenUsage } from "../../../../../backend/src/contracts/token-usage";
import { TokenUsageMapper } from "../../../../../backend/src/contracts/token-usage";
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
  rightSidebarVisible: boolean;
  onToggleRightSidebar: () => void;
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
  rightSidebarVisible,
  onToggleRightSidebar,
  onOpenSettings,
  settingsPressed = false,
}: ChatTitlePanelProps) {
  const [title, setTitle] = useState("New chat");
  const [tokenTotals, setTokenTotals] = useState<EntryTokenUsage>({
    promptTokens: 0,
    cachedPromptTokens: 0,
    completionTokens: 0,
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

  useEffect(() => {
    setTitle(conversationId ? "Untitled" : "New chat");
    setTokenTotals({ promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0 });
    setTokenUsageByModel([]);
    setConversationUpdatedAt("");
    if (!conversationId) return;
    let cancelled = false;
    void (async () => {
      try {
        const row = await getConversation(conversationId);
        if (cancelled) return;
        setTitle(row.title || "Untitled");
        setTokenTotals(TokenUsageMapper.fromConversationTotals(row));
        setTokenUsageByModel(row.tokenUsageByModel ?? []);
        setConversationUpdatedAt(String(row.updatedAt ?? ""));
      } catch (e) {
        if (cancelled) return;
        const detail = e instanceof Error ? e.message : String(e);
        notifyError(`Failed to load conversation: ${detail}`);
      }
    })();
    return () => {
      cancelled = true;
    };
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
        if (ev.conversationId !== cid) return;
        if (ev.type !== SseType.CONVERSATION_UPDATED) return;
        const currentMs = timestampMs(conversationUpdatedAt);
        const incomingMs = timestampMs(ev.conversation.updatedAt);
        if (currentMs != null && incomingMs != null && incomingMs < currentMs) return;
        setTitle(String(ev.conversation.title || "Untitled"));
        setTokenTotals(TokenUsageMapper.fromConversationTotals(ev.conversation));
        setTokenUsageByModel(ev.conversation.tokenUsageByModel ?? []);
        setConversationUpdatedAt(String(ev.conversation.updatedAt ?? ""));
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
          <EditableConversationTitle title={title} disabled={!conversationId} onCommit={onCommit} />
          <LlmMetaBadge usage={tokenTotals} showTokenBreakdown estimatedCostUsd={estimatedCostUsd} />
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={onToggleRightSidebar}
          aria-label={rightSidebarVisible ? "Hide activity sidebar" : "Show activity sidebar"}
          title={rightSidebarVisible ? "Hide activity" : "Show activity"}
        >
          {rightSidebarVisible ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
        </Button>
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
