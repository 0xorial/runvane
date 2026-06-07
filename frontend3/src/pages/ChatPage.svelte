<script lang="ts">
  import ChatTranscript from "@/components/chat/ChatTranscript.svelte";
  import ChatComposer from "@/components/chat/ChatComposer.svelte";
  import ChatTitlePanel from "@/components/chat/ChatTitlePanel.svelte";
  import ConversationBranchesPanel from "@/components/chat/ConversationBranchesPanel.svelte";
  import { createChatSessionState } from "@/lib/chatSessionState.svelte";
  import { setChatSessionContext } from "@/lib/chatSessionContext";
  import { chatSearch, navigate, settingsLinkFromSearch } from "@/lib/router";

  let {
    conversationId,
    search,
    sidebarVisible,
    onToggleSidebar,
    rightSidebarVisible,
    onToggleRightSidebar,
    settingsPressed,
  }: {
    conversationId: string | null;
    search: string;
    sidebarVisible: boolean;
    onToggleSidebar: () => void;
    rightSidebarVisible: boolean;
    onToggleRightSidebar: () => void;
    settingsPressed: boolean;
  } = $props();

  const session = createChatSessionState(() => conversationId);

  setChatSessionContext({
    getConversationId: () => conversationId,
    getActivePathEntries: () => session.activePathEntries,
    setActiveLeaf: (entryId) => session.setActiveLeaf(entryId),
    switchToBranch: (branchEntryId) => session.switchToBranch(branchEntryId),
    siblingsOf: (entryId) => session.store.siblingsOf(entryId),
  });

  function openSettings(): void {
    navigate(settingsLinkFromSearch($chatSearch));
  }
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
  <ChatTitlePanel
    {conversationId}
    {sidebarVisible}
    {onToggleSidebar}
    {rightSidebarVisible}
    {onToggleRightSidebar}
    onOpenSettings={openSettings}
    {settingsPressed}
  />
  <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ChatTranscript
        {conversationId}
        entries={session.activePathEntries}
        isSessionLoading={session.isSessionLoading}
      />
      <ChatComposer
        {conversationId}
        {search}
        pendingMessages={session.pendingMessages}
        appendOptimisticUserMessage={session.appendOptimisticUserMessage}
      />
    </div>
    {#if rightSidebarVisible}
      <div class="w-[min(280px,28vw)] shrink-0">
        <ConversationBranchesPanel
          {conversationId}
          allEntries={session.allEntries}
          activePathEntries={session.activePathEntries}
          switchToBranch={session.switchToBranch}
        />
      </div>
    {/if}
  </div>
</div>
