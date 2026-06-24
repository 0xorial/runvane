<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { getConversation } from "@/api/client";
  import { queryKeys } from "@/hooks/queries/keys";
  import { navigate } from "@/lib/router";

  let { conversationId }: { conversationId: string | null } = $props();

  const conversationQuery = createQuery(() => ({
    queryKey: queryKeys.conversation(conversationId?.trim() ?? ""),
    queryFn: () => getConversation(conversationId!.trim()),
    enabled: Boolean(conversationId?.trim()),
  }));

  const forkedFromId = $derived(conversationQuery.data?.forkedFromConversationId ?? null);
  const forkedFromTitle = $derived((conversationQuery.data?.forkedFromConversationTitle ?? "").trim());
</script>

{#if forkedFromId}
  <div
    data-testid="forked-from-banner"
    class="flex shrink-0 items-center gap-1.5 border-b border-border bg-card/30 px-3 py-1 text-[11px] text-muted-foreground"
  >
    <svg class="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M6 8.5v7" />
      <path d="M18 10.5a6 6 0 0 1-6 6H8.5" />
    </svg>
    <span>Forked from</span>
    <button
      type="button"
      data-testid="forked-from-link"
      class="inline-flex min-w-0 items-center rounded font-medium text-primary hover:underline"
      onclick={() => navigate(`/chat/${forkedFromId}`)}
      title="Open the conversation this was split from"
    >
      <span class="truncate">{forkedFromTitle || "previous conversation"}</span>
    </button>
  </div>
{/if}
