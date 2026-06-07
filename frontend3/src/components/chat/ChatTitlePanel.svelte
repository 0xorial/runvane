<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { getConversation, renameConversation } from "@/api/client";
  import { queryKeys } from "@/hooks/queries/keys";
  import { createModelCapabilitiesQuery, pricingFromCapabilities } from "@/hooks/queries/referenceData";
  import { subscribeGlobalLive } from "@/protocol/runLiveClient";
  import { SseType } from "@/protocol/sseTypes";
  import { TokenUsageMapper, type EntryTokenUsage } from "../../../../backend/src/contracts/token-usage";
  import { estimateConversationCostUsd, hasUnpricedUsage } from "@/lib/costEstimation";
  import { notifyError } from "@/utils/toast";
  import { onMount } from "svelte";
  import ThemeToggle from "@/components/ThemeToggle.svelte";
  import LlmMetaBadge from "./LlmMetaBadge.svelte";
  import EditableConversationTitle from "./header/EditableConversationTitle.svelte";
  import TaskStatusButton from "./header/TaskStatusButton.svelte";

  let {
    conversationId,
    sidebarVisible,
    onToggleSidebar,
    rightSidebarVisible,
    onToggleRightSidebar,
    onOpenSettings,
    settingsPressed = false,
  }: {
    conversationId: string | null;
    sidebarVisible: boolean;
    onToggleSidebar: () => void;
    rightSidebarVisible: boolean;
    onToggleRightSidebar: () => void;
    onOpenSettings: () => void;
    settingsPressed?: boolean;
  } = $props();

  let title = $state("New chat");
  let tokenTotals = $state<EntryTokenUsage>({ promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0 });
  let tokenUsageByModel = $state<{ modelName: string; promptTokens: number; cachedPromptTokens: number; completionTokens: number }[]>([]);
  let conversationUpdatedAt = $state("");
  let settingsClickPressed = $state(false);

  const conversationQuery = createQuery(() => ({
    queryKey: queryKeys.conversation(conversationId?.trim() ?? ""),
    queryFn: () => getConversation(conversationId!.trim()),
    enabled: Boolean(conversationId?.trim()),
  }));

  const pricingQuery = createModelCapabilitiesQuery();
  const pricingByModel = $derived(pricingFromCapabilities(pricingQuery.data));

  const estimatedCostUsd = $derived.by(() => {
    const total =
      (tokenTotals.promptTokens ?? 0) + (tokenTotals.cachedPromptTokens ?? 0) + (tokenTotals.completionTokens ?? 0);
    if (total === 0) return 0;
    if (tokenUsageByModel.length === 0) return null;
    if (hasUnpricedUsage(tokenUsageByModel, pricingByModel)) return null;
    return estimateConversationCostUsd(tokenUsageByModel, pricingByModel);
  });

  const unpricedModels = $derived(
    tokenUsageByModel
      .filter((u) => !pricingByModel.has(String(u.modelName || "").trim()))
      .map((u) => String(u.modelName || "").trim())
      .filter((name) => name.length > 0),
  );

  $effect(() => {
    if (!conversationId) {
      title = "New chat";
      tokenTotals = { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0 };
      tokenUsageByModel = [];
      conversationUpdatedAt = "";
      return;
    }
    const row = conversationQuery.data;
    if (!row) return;
    title = String(row.title || "Untitled");
    tokenTotals = TokenUsageMapper.fromConversationTotals(row);
    tokenUsageByModel = row.tokenUsageByModel ?? [];
    conversationUpdatedAt = String(row.updatedAt ?? "");
  });

  onMount(() => {
    return subscribeGlobalLive({
      onSseEvent: (ev) => {
        const cid = conversationId?.trim();
        if (!cid || ev.conversationId !== cid || ev.type !== SseType.CONVERSATION_UPDATED) return;
        const currentMs = Date.parse(conversationUpdatedAt);
        const incomingMs = Date.parse(String(ev.conversation.updatedAt ?? ""));
        if (Number.isFinite(currentMs) && Number.isFinite(incomingMs) && incomingMs < currentMs) return;
        title = String(ev.conversation.title || "Untitled");
        tokenTotals = TokenUsageMapper.fromConversationTotals(ev.conversation);
        tokenUsageByModel = ev.conversation.tokenUsageByModel ?? [];
        conversationUpdatedAt = String(ev.conversation.updatedAt ?? "");
      },
    });
  });

  async function onCommit(nextTitle: string): Promise<void> {
    if (!conversationId) return;
    try {
      const updated = await renameConversation(conversationId, { title: nextTitle });
      title = String(updated.title || nextTitle);
    } catch (e) {
      notifyError(`Failed to rename chat: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }
</script>

<div class="relative z-10 flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card/40 px-3">
  <button
    type="button"
    class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
    aria-label={sidebarVisible ? "Hide chat sidebar" : "Show chat sidebar"}
    onclick={onToggleSidebar}
  >
    {sidebarVisible ? "◧" : "◨"}
  </button>
  <div class="min-w-0 flex-1">
    <div class="flex min-w-0 items-center gap-2">
      <EditableConversationTitle {title} disabled={!conversationId} onCommit={onCommit} />
      <LlmMetaBadge
        usage={tokenTotals}
        showTokenBreakdown
        estimatedCostUsd={estimatedCostUsd}
        {unpricedModels}
      />
    </div>
  </div>
  <div class="flex items-center gap-0.5">
    <button
      type="button"
      class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label={rightSidebarVisible ? "Hide activity sidebar" : "Show activity sidebar"}
      onclick={onToggleRightSidebar}
    >
      {rightSidebarVisible ? "▥" : "▤"}
    </button>
    <TaskStatusButton {conversationId} />
    <ThemeToggle />
    <button
      type="button"
      data-testid="open-settings"
      class="inline-flex h-7 w-7 items-center justify-center rounded-md {settingsPressed || settingsClickPressed
        ? 'bg-muted text-foreground'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
      aria-label="Open settings"
      onclick={() => {
        settingsClickPressed = true;
        onOpenSettings();
      }}
    >
      ⚙
    </button>
  </div>
</div>
