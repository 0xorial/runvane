<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { getConversation, renameConversation } from "@/api/client";
  import { queryKeys } from "@/hooks/queries/keys";
  import { subscribeGlobalLive } from "@/protocol/runLiveClient";
  import { SseType } from "@/protocol/sseTypes";
  import { TokenUsageMapper } from "../../../../backend/src/contracts/token-usage";
  import { buildModelPricingByName, estimateConversationCostUsd, hasUnpricedUsage } from "@/lib/costEstimation";
  import { getModelCapabilities } from "@/api/client";
  import { onMount } from "svelte";

  let {
    conversationId,
    onOpenSettings,
  }: {
    conversationId: string | null;
    onOpenSettings?: () => void;
  } = $props();

  let title = $state("New chat");
  let conversationUpdatedAt = $state("");

  const conversationQuery = createQuery(() => ({
    queryKey: queryKeys.conversation(conversationId?.trim() ?? ""),
    queryFn: () => getConversation(conversationId!.trim()),
    enabled: Boolean(conversationId?.trim()),
  }));

  const pricingQuery = createQuery(() => ({
    queryKey: queryKeys.modelCapabilities,
    queryFn: async () => buildModelPricingByName((await getModelCapabilities()).models),
  }));

  $effect(() => {
    if (!conversationId) {
      title = "New chat";
      return;
    }
    const row = conversationQuery.data;
    if (!row) return;
    title = String(row.title || "Untitled");
    conversationUpdatedAt = String(row.updatedAt ?? "");
  });

  const estimatedCostUsd = $derived.by(() => {
    const row = conversationQuery.data;
    const pricingByModel = pricingQuery.data ?? new Map();
    if (!row) return null;
    const totals = TokenUsageMapper.fromConversationTotals(row);
    const totalTokens =
      (totals.promptTokens ?? 0) + (totals.cachedPromptTokens ?? 0) + (totals.completionTokens ?? 0);
    if (totalTokens === 0) return 0;
    const usage = row.tokenUsageByModel ?? [];
    if (usage.length === 0) return null;
    if (hasUnpricedUsage(usage, pricingByModel)) return null;
    return estimateConversationCostUsd(usage, pricingByModel);
  });

  onMount(() => {
    return subscribeGlobalLive({
      onSseEvent: (ev) => {
        const cid = conversationId?.trim();
        if (!cid || ev.conversationId !== cid) return;
        if (ev.type !== SseType.CONVERSATION_UPDATED) return;
        title = String(ev.conversation.title || "Untitled");
        conversationUpdatedAt = String(ev.conversation.updatedAt ?? "");
      },
    });
  });

  async function commitTitle(next: string): Promise<void> {
    if (!conversationId) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    const updated = await renameConversation(conversationId, { title: trimmed });
    title = String(updated.title || trimmed);
  }
</script>

<header class="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
  <div class="min-w-0 flex-1">
    {#if conversationId}
      <input
        data-testid="conversation-title"
        class="w-full truncate bg-transparent text-sm font-medium outline-none"
        value={title}
        onchange={(e) => void commitTitle(e.currentTarget.value)}
      />
    {:else}
      <span class="text-sm font-medium text-muted-foreground">New chat</span>
    {/if}
    {#if estimatedCostUsd != null && conversationId}
      <span class="text-[11px] text-muted-foreground">
        {estimatedCostUsd === 0 ? "$0.00" : `$${estimatedCostUsd.toFixed(4)}`}
      </span>
    {/if}
  </div>
  {#if onOpenSettings}
    <button
      type="button"
      data-testid="open-settings"
      class="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      onclick={onOpenSettings}
    >
      Settings
    </button>
  {/if}
</header>
