<script lang="ts">
  import ChatTranscript from "@/components/chat/ChatTranscript.svelte";
  import ChatComposer from "@/components/chat/ChatComposer.svelte";
  import { createChatSessionState } from "@/lib/chatSessionState.svelte";
  import { agentIdFromSearch } from "@/lib/router";

  let {
    conversationId,
    search,
  }: {
    conversationId: string | null;
    search: string;
  } = $props();

  const session = createChatSessionState(() => conversationId);
  const agentId = $derived(agentIdFromSearch(search));
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
  <header class="shrink-0 border-b border-border px-3 py-2 text-sm font-medium">
    {conversationId ? "Chat" : "New chat"}
  </header>
  <ChatTranscript
    {conversationId}
    entries={session.activePathEntries}
    isSessionLoading={session.isSessionLoading}
  />
  <ChatComposer {conversationId} {agentId} />
</div>
