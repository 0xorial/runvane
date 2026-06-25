<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { getConversationConfig } from "@/api/client";
  import { queryKeys } from "@/hooks/queries/keys";
  import { navigate } from "@/lib/router";
  import { DEFAULT_CONVERSATION_CATEGORIZATION_CONFIG } from "../../../../backend/src/contracts/conversation-config";
  import ChatToolsPanel from "./ChatToolsPanel.svelte";
  import ConversationsView from "./ConversationsView.svelte";

  let {
    onNewChat,
    onSelect,
    search = "",
  }: {
    onNewChat: () => void;
    onSelect: (id: string) => void;
    search?: string;
  } = $props();

  const configQuery = createQuery(() => ({
    queryKey: queryKeys.conversationConfig,
    queryFn: getConversationConfig,
    staleTime: 60_000,
  }));
  const recentLimit = $derived(
    configQuery.data?.sidebarRecentLimit ?? DEFAULT_CONVERSATION_CATEGORIZATION_CONFIG.sidebarRecentLimit,
  );

  function openAllConversations(): void {
    navigate(`/conversations${search}`);
  }
</script>

<aside class="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar">
  <div class="flex shrink-0 items-center gap-1.5 border-b border-sidebar-border px-2.5 py-2">
    <svg class="h-4 w-4 shrink-0 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
    </svg>
    <span class="text-sm font-semibold tracking-tight text-foreground">Runvane</span>
  </div>

  <ConversationsView {onSelect} {onNewChat} onShowAll={openAllConversations} showProbe recentLimit={recentLimit} />

  <ChatToolsPanel {search} />
</aside>
