<script lang="ts">
  import { createConversation } from "@/api/client";
  import { getChatSessionStore, retainChatSessionLive } from "@/lib/chatSessionRegistry";
  import type { OptimisticUserMessage } from "@/lib/chatSessionState.svelte";
  import { replacePath } from "@/lib/router";
  import { sendMessageToConversation } from "./sendMessage";

  let {
    conversationId,
    agentId,
    search,
    appendOptimisticUserMessage,
  }: {
    conversationId: string | null;
    agentId: string;
    search: string;
    appendOptimisticUserMessage: (input: {
      conversationId: string;
      text: string;
      agentId: string;
    }) => OptimisticUserMessage | null;
  } = $props();

  let input = $state("");
  let sending = $state(false);

  const canSend = $derived(input.trim().length > 0 && Boolean(agentId));

  async function send(): Promise<void> {
    if (!canSend || sending) return;
    sending = true;
    const text = input.trim();
    input = "";
    const clientRequestId = crypto.randomUUID();

    try {
      if (!conversationId) {
        const created = await createConversation();
        const cid = String(created.id || "").trim();
        if (!cid) throw new Error("createConversation returned no id");

        retainChatSessionLive();
        getChatSessionStore(cid);

        await sendMessageToConversation(cid, text, agentId, null, null, [], null, clientRequestId);
        replacePath(`/chat/${encodeURIComponent(cid)}${search}`);
        return;
      }

      const optimistic = appendOptimisticUserMessage({ conversationId, text, agentId });
      if (!optimistic) throw new Error("appendOptimisticUserMessage failed");

      await sendMessageToConversation(
        conversationId,
        text,
        agentId,
        null,
        null,
        [],
        optimistic.parentId,
        optimistic.clientRequestId,
      );
    } catch (err) {
      console.error("[ChatComposer] send failed", err);
      input = text;
      throw err;
    } finally {
      sending = false;
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }
</script>

<div class="border-t border-border bg-card/50 p-3">
  <textarea
    data-testid="chat-user-input"
    class="mb-2 min-h-[4rem] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
    placeholder="Send a message…"
    bind:value={input}
    onkeydown={onKeydown}
    disabled={!agentId}
  ></textarea>
  <div class="flex justify-end gap-2">
    <button
      type="button"
      class="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
      aria-label="Attach files"
      disabled
    >
      Attach files
    </button>
    <button
      type="button"
      data-testid="chat-send-button"
      class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
      disabled={!canSend || sending}
      onclick={() => void send()}
    >
      Send
    </button>
  </div>
</div>
