<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { getConversation, renameConversation } from "@/api/client";
  import { queryKeys } from "@/hooks/queries/keys";
  import { createModelCapabilitiesQuery, pricingFromCapabilities } from "@/hooks/queries/referenceData";
  import { subscribeGlobalLive } from "@/protocol/runLiveClient";
  import { SseType } from "@/protocol/sseTypes";
  import { TokenUsageMapper, type EntryTokenUsage } from "../../../../backend/src/contracts/token-usage";
  import { estimateConversationCostUsd, hasUnpricedUsage, unpricedModelsWithUsage } from "@/lib/costEstimation";
  import { notifyError } from "@/utils/toast";
  import { onMount } from "svelte";
  import ThemeToggle from "@/components/ThemeToggle.svelte";
  import LlmMetaBadge from "./LlmMetaBadge.svelte";
  import EditableConversationTitle from "./header/EditableConversationTitle.svelte";
  import PanelIconButton from "./header/PanelIconButton.svelte";
  import TaskStatusButton from "./header/TaskStatusButton.svelte";
  import ChatToolEnvironmentBadge from "./ChatToolEnvironmentBadge.svelte";

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

  const toolEnvironmentId = $derived(conversationQuery.data?.toolEnvironmentId ?? null);

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

  const unpricedModels = $derived(unpricedModelsWithUsage(tokenUsageByModel, pricingByModel));

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

<div class="relative z-10 flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card/40 px-3 backdrop-blur-sm">
  <PanelIconButton
    title={sidebarVisible ? "Hide chats" : "Show chats"}
    onclick={onToggleSidebar}
  >
    {#snippet children()}
      <svg class="h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        {#if sidebarVisible}
          <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /><path d="m16 15-3-3 3-3" />
        {:else}
          <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /><path d="m14 9 3 3-3 3" />
        {/if}
      </svg>
    {/snippet}
  </PanelIconButton>
  <div class="min-w-0 flex-1">
    <div class="flex min-w-0 items-center gap-2">
      <EditableConversationTitle {title} disabled={!conversationId} onCommit={onCommit} />
      <LlmMetaBadge
        usage={tokenTotals}
        showTokenBreakdown
        estimatedCostUsd={estimatedCostUsd}
        {unpricedModels}
      />
      {#if conversationId && conversationQuery.data}
        <ChatToolEnvironmentBadge {toolEnvironmentId} />
      {/if}
    </div>
  </div>
  <div class="flex items-center gap-0.5">
    <PanelIconButton
      title={rightSidebarVisible ? "Hide activity" : "Show activity"}
      onclick={onToggleRightSidebar}
    >
      {#snippet children()}
        <svg class="h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          {#if rightSidebarVisible}
            <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" /><path d="m8 9 3 3-3 3" />
          {:else}
            <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" /><path d="m10 9-3 3 3 3" />
          {/if}
        </svg>
      {/snippet}
    </PanelIconButton>
    <TaskStatusButton {conversationId} />
    <ThemeToggle />
    <PanelIconButton
      title="Settings"
      testId="open-settings"
      pressed={settingsPressed || settingsClickPressed}
      onclick={() => {
        settingsClickPressed = true;
        onOpenSettings();
      }}
    >
      {#snippet children()}
        <svg class="h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" />
        </svg>
      {/snippet}
    </PanelIconButton>
  </div>
</div>
