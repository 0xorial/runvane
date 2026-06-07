<script lang="ts">
  import ConversationSidebar from "@/components/sidebar/ConversationSidebar.svelte";
  import ChatPage from "@/pages/ChatPage.svelte";
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import { queryClient } from "@/lib/queryClient";
  import { pathname, chatConversationId, chatSearch, navigate } from "@/lib/router";
  import { fetchConversationSession } from "@/hooks/queries/conversations";

  function onSelectConversation(id: string): void {
    void fetchConversationSession(id);
    navigate(`/chat/${encodeURIComponent(id)}${$chatSearch}`);
  }
</script>

<QueryClientProvider client={queryClient}>
  <div class="flex h-dvh overflow-hidden bg-background text-foreground">
    <div class="w-[min(300px,30vw)] shrink-0">
      <ConversationSidebar
        activeConversationId={$chatConversationId}
        search={$chatSearch}
        onSelect={onSelectConversation}
      />
    </div>
    <main class="flex min-h-0 min-w-0 flex-1 flex-col">
      {#if $pathname.startsWith("/chat")}
        <ChatPage conversationId={$chatConversationId} search={$chatSearch} />
      {:else}
        <div class="p-8 text-sm text-muted-foreground">Unknown route {$pathname}</div>
      {/if}
    </main>
  </div>
</QueryClientProvider>
