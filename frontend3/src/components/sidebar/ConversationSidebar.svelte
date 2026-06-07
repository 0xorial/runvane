<script lang="ts">
  import {
    createConversation,
    postConversationMessage,
  } from "@/api/client";
  import { refreshConversations } from "@/hooks/queries/conversations";
  import type { ConversationRow } from "../../../../backend/src/contracts/conversations";
  import { getChatSessionStore, retainChatSessionLive } from "@/lib/chatSessionRegistry";
  import { navigate, replacePath } from "@/lib/router";
  import { onMount } from "svelte";

  const PROBE_MESSAGE = "what is the time?";

  let {
    activeConversationId,
    search,
    onSelect,
  }: {
    activeConversationId: string | null;
    search: string;
    onSelect: (id: string) => void;
  } = $props();

  let conversations = $state<ConversationRow[]>([]);
  let probeBusy = $state(false);

  onMount(() => {
    void refreshConversations(false).then((data) => {
      conversations = data.conversations;
    });
  });

  function newChat(): void {
    navigate(`/chat/new${search}`);
  }

  async function runProbeTime(): Promise<void> {
    if (probeBusy) return;
    probeBusy = true;
    try {
      const agentId = new URLSearchParams(search).get("agent")?.trim() || "";
      if (!agentId) throw new Error("Select an agent first (?agent= in URL)");

      const created = await createConversation({ title: "New chat" });
      const id = String(created.id || "").trim();
      if (!id) throw new Error("No conversation id from server");

      retainChatSessionLive();
      getChatSessionStore(id);

      await postConversationMessage(id, { message: PROBE_MESSAGE, agentId });

      replacePath(`/chat/${encodeURIComponent(id)}${search}`);
    } finally {
      probeBusy = false;
    }
  }
</script>

<aside class="flex h-full min-h-0 w-full flex-col border-r border-border bg-sidebar">
  <div class="shrink-0 space-y-1.5 border-b border-border px-2.5 py-2">
    <button
      type="button"
      data-testid="sidebar-new-chat"
      class="w-full rounded-md bg-primary/10 px-2.5 py-1.5 text-left text-xs font-medium text-primary"
      onclick={newChat}
    >
      New Chat
    </button>
    <button
      type="button"
      data-testid="sidebar-probe-time"
      class="w-full rounded-md px-1 py-0.5 text-left text-xs text-muted-foreground disabled:opacity-50"
      disabled={probeBusy}
      onclick={() => void runProbeTime()}
    >
      Probe: time (tmp)
    </button>
  </div>

  <div
    id="conversation-sidebar-list"
    class="scrollbar-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 py-1.5"
  >
    {#each conversations as conversation (conversation.id)}
      <div
        data-conversation-row
        data-conversation-id={conversation.id}
        data-active={activeConversationId === conversation.id ? "true" : "false"}
        class="rounded-md data-[active=true]:bg-secondary"
      >
        <button
          type="button"
          data-testid={`sidebar-conversation-${conversation.id}`}
          class="w-full truncate px-2 py-1.5 text-left text-xs text-foreground"
          onclick={() => onSelect(conversation.id)}
        >
          {conversation.title || "Untitled"}
        </button>
      </div>
    {/each}
  </div>
</aside>
