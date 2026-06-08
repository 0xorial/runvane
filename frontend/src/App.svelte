<script lang="ts">
  import ConversationSidebar from "@/components/sidebar/ConversationSidebar.svelte";
  import ResizableSidePanel from "@/components/ui/ResizableSidePanel.svelte";
  import ChatPage from "@/pages/ChatPage.svelte";
  import SettingsPage from "@/pages/SettingsPage.svelte";
  import ToastHost from "@/components/ToastHost.svelte";
  import ErrorInboxButton from "@/components/ErrorInboxButton.svelte";
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
  import { navBtnBase, navBtnDefault, navBtnOutline } from "@/lib/buttonClasses";
  import { onMount } from "svelte";

  let chatSidebarVisible = $state(true);
  let chatRightSidebarVisible = $state(true);

  const sidebarDefaultSize = $derived.by(() => {
    if (typeof window === "undefined") return 14;
    const rawPercent = (300 / Math.max(1, window.innerWidth)) * 100;
    return Math.max(1, Math.min(95, rawPercent));
  });

  onMount(() => {
    retainChatSessionLive();
    if ($pathOnly === "/chat") navigate(`/chat/new${$chatSearch}`);
    if ($pathOnly === "/settings") navigate(settingsLinkFromSearch($chatSearch));
    if ($pathOnly === "/permissions") navigate("/settings/tools");
  });

  $effect(() => {
    if ($pathOnly === "/permissions") navigate("/settings/tools");
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
      <header
        class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card/50 px-3 py-2 backdrop-blur-sm"
      >
        <div class="flex flex-wrap items-center gap-2 md:gap-3">
          <span class="text-sm font-semibold tracking-tight text-foreground">Runvane</span>
          <nav class="flex flex-wrap gap-2">
            <button
              type="button"
              class="{navBtnBase} {$isChatRoute ? navBtnDefault : navBtnOutline}"
              onclick={() => navigate(`/chat/new${$chatSearch}`)}
            >
              Chat
            </button>
            <button
              type="button"
              class="{navBtnBase} {$isSettingsRoute ? navBtnDefault : navBtnOutline}"
              onclick={() => navigate(settingsLinkFromSearch($chatSearch))}
            >
              Settings
            </button>
          </nav>
        </div>
        <div class="flex items-center gap-2">
          <ErrorInboxButton />
          <ThemeToggle />
        </div>
      </header>
    {/if}

    <div class="flex min-h-0 flex-1 overflow-hidden">
      {#if $isChatRoute}
        <ResizableSidePanel
          open={chatSidebarVisible}
          onOpenChange={(open) => (chatSidebarVisible = open)}
          defaultSize={sidebarDefaultSize}
          minSize={10}
        >
          {#snippet side()}
            <ConversationSidebar
              onNewChat={onNewChat}
              onSelect={onSelectConversation}
              search={$chatSearch}
            />
          {/snippet}
          {#snippet children()}
            <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <ChatPage
                conversationId={$chatConversationId}
                search={$chatSearch}
                sidebarVisible={chatSidebarVisible}
                onToggleSidebar={() => (chatSidebarVisible = !chatSidebarVisible)}
                rightSidebarVisible={chatRightSidebarVisible}
                onToggleRightSidebar={() => (chatRightSidebarVisible = !chatRightSidebarVisible)}
                settingsPressed={$isSettingsRoute}
              />
            </main>
          {/snippet}
        </ResizableSidePanel>
      {:else}
        <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {#if $isSettingsRoute}
            <SettingsPage sectionRaw={$settingsSection} />
          {:else}
            <div class="p-8 text-sm text-muted-foreground">Unknown route {$pathname}</div>
          {/if}
        </main>
      {/if}
    </div>
  </div>
</QueryClientProvider>
