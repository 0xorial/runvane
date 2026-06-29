<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { getConversationConfig } from "@/api/client";
  import { queryKeys } from "@/hooks/queries/keys";
  import { navigate } from "@/lib/router";
  import { DEFAULT_CONVERSATION_CATEGORIZATION_CONFIG } from "../../../../backend/src/contracts/conversation-config";
  import ChatToolsPanel from "./ChatToolsPanel.svelte";
  import ConversationsView from "./ConversationsView.svelte";
  import { Pane, PaneGroup, PaneResizer } from "paneforge";

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

  <PaneGroup direction="vertical" autoSaveId="sidebar-conversations-tools-split" class="min-h-0 flex-1">
    <Pane defaultSize={60} minSize={20} class="min-h-0 overflow-hidden">
      <ConversationsView {onSelect} {onNewChat} onShowAll={openAllConversations} showProbe recentLimit={recentLimit} />
    </Pane>
    <PaneResizer
      class="relative flex h-px shrink-0 items-center justify-center bg-border transition-colors after:absolute after:inset-x-0 after:top-1/2 after:h-1 after:-translate-y-1/2 hover:bg-primary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1"
    >
      <div class="z-10 flex h-3 w-4 items-center justify-center rounded-sm border bg-border">
        <svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="9" r="1" /><circle cx="5" cy="9" r="1" /><circle cx="19" cy="9" r="1" />
          <circle cx="12" cy="15" r="1" /><circle cx="5" cy="15" r="1" /><circle cx="19" cy="15" r="1" />
        </svg>
      </div>
    </PaneResizer>
    <Pane defaultSize={40} minSize={15} class="min-h-0 overflow-hidden">
      <ChatToolsPanel {search} />
    </Pane>
  </PaneGroup>
</aside>
