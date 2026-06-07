<script lang="ts">
  import ConversationSidebar from "@/components/sidebar/ConversationSidebar.svelte";
  import ChatPage from "@/pages/ChatPage.svelte";
  import SettingsPage from "@/pages/SettingsPage.svelte";
  import ToastHost from "@/components/ToastHost.svelte";
  import ThemeToggle from "@/components/ThemeToggle.svelte";
  import { QueryClientProvider } from "@tanstack/svelte-query";
  import { queryClient } from "@/lib/queryClient";
  import {
    pathname,
    pathOnly,
    chatConversationId,
    chatSearch,
    settingsSection,
    isChatRoute,
    isSettingsRoute,
    navigate,
    settingsLinkFromSearch,
  } from "@/lib/router";
  import { fetchConversationSession } from "@/hooks/queries/conversations";
  import { retainChatSessionLive } from "@/lib/chatSessionRegistry";
  import { onMount } from "svelte";

  let chatSidebarVisible = $state(true);
  let chatRightSidebarVisible = $state(true);

  onMount(() => {
    retainChatSessionLive();
    if ($pathOnly === "/chat") navigate(`/chat/new${$chatSearch}`);
    if ($pathOnly === "/settings") navigate(settingsLinkFromSearch($chatSearch));
  });

  $effect(() => {
    const id = $chatConversationId;
    if (!id) return;
    const rows = document.querySelectorAll("[data-conversation-row]");
    for (const row of rows) {
      const rowId = row.getAttribute("data-conversation-id");
      row.setAttribute("data-active", rowId === id ? "true" : "false");
    }
  });

  function onNewChat(): void {
    navigate(`/chat/new${$chatSearch}`);
  }

  function onSelectConversation(id: string): void {
    void fetchConversationSession(id);
    navigate(`/chat/${encodeURIComponent(id)}${$chatSearch}`);
  }
</script>

<QueryClientProvider client={queryClient}>
  <div class="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
    <ToastHost />
    {#if !$isChatRoute}
      <header class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card/50 px-3 py-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-semibold tracking-tight">Runvane</span>
          <nav class="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              class="rounded-md border px-2 py-1 {$isChatRoute ? 'bg-primary text-primary-foreground' : 'border-border'}"
              onclick={() => navigate(`/chat/new${$chatSearch}`)}
            >
              Chat
            </button>
            <button
              type="button"
              class="rounded-md border px-2 py-1 {$isSettingsRoute ? 'bg-primary text-primary-foreground' : 'border-border'}"
              onclick={() => navigate(settingsLinkFromSearch($chatSearch))}
            >
              Settings
            </button>
          </nav>
        </div>
        <ThemeToggle />
      </header>
    {/if}

    <div class="flex min-h-0 flex-1 overflow-hidden">
      {#if $isChatRoute}
        <div
          class="h-full shrink-0 overflow-hidden transition-opacity duration-200 {chatSidebarVisible
            ? 'w-[min(300px,30vw)] opacity-100'
            : 'pointer-events-none w-0 opacity-0'}"
        >
          <ConversationSidebar onNewChat={onNewChat} onSelect={onSelectConversation} />
        </div>
      {/if}

      <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {#if $isChatRoute}
          <ChatPage
            conversationId={$chatConversationId}
            search={$chatSearch}
            sidebarVisible={chatSidebarVisible}
            onToggleSidebar={() => (chatSidebarVisible = !chatSidebarVisible)}
            rightSidebarVisible={chatRightSidebarVisible}
            onToggleRightSidebar={() => (chatRightSidebarVisible = !chatRightSidebarVisible)}
            settingsPressed={$isSettingsRoute}
          />
        {:else if $isSettingsRoute}
          <SettingsPage sectionRaw={$settingsSection} />
        {:else}
          <div class="p-8 text-sm text-muted-foreground">Unknown route {$pathname}</div>
        {/if}
      </main>
    </div>
  </div>
</QueryClientProvider>
