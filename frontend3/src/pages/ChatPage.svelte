<script lang="ts">
  import ChatTranscript from "@/components/chat/ChatTranscript.svelte";
  import ChatComposer from "@/components/chat/ChatComposer.svelte";
  import ChatTitlePanel from "@/components/chat/ChatTitlePanel.svelte";
  import { createChatSessionState } from "@/lib/chatSessionState.svelte";
  import { agentIdFromSearch, navigate } from "@/lib/router";

  let {
    conversationId,
    search,
  }: {
    conversationId: string | null;
    search: string;
  } = $props();

  const session = createChatSessionState(() => conversationId);
  const agentId = $derived(agentIdFromSearch(search));
  function openSettings(): void {
    navigate(`/settings${search}`);
  }
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
  <ChatTitlePanel {conversationId} onOpenSettings={openSettings} />
  <ChatTranscript
    {conversationId}
    entries={session.activePathEntries}
    isSessionLoading={session.isSessionLoading}
  />
  <ChatComposer
    {conversationId}
    {agentId}
    {search}
    pendingMessages={session.pendingMessages}
    appendOptimisticUserMessage={session.appendOptimisticUserMessage}
  />
</div>
