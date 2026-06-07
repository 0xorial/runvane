<script lang="ts">
  import { cancelPendingMessage, createConversation } from "@/api/client";
  import type { LlmRef } from "../../../../backend/src/contracts/llm";
  import { getChatSessionStore, retainChatSessionLive } from "@/lib/chatSessionRegistry";
  import type { OptimisticUserMessage } from "@/lib/chatSessionState.svelte";
  import { conversationHasRunningTask, ensureTasksStream } from "@/lib/tasksStore.svelte";
  import { agentIdFromSearch, replacePath } from "@/lib/router";
  import { onMount } from "svelte";
  import type { ChatAgentSelection } from "./ChatAgentToolbar.svelte";
  import MessageComposer from "./MessageComposer.svelte";
  import QueuedMessageChips from "./QueuedMessageChips.svelte";
  import type { PendingMessage } from "@/lib/chatSessionStore";
  import { sendMessageToConversation, type MessageSendMode } from "./sendMessage";

  let {
    conversationId,
    search,
    pendingMessages = [],
    appendOptimisticUserMessage,
  }: {
    conversationId: string | null;
    search: string;
    pendingMessages?: PendingMessage[];
    appendOptimisticUserMessage: (input: {
      conversationId: string;
      text: string;
      agentId: string;
      llm?: LlmRef;
      modelPresetId?: number | null;
    }) => OptimisticUserMessage | null;
  } = $props();

  let input = $state("");
  let sending = $state(false);
  let agentSelection = $state<ChatAgentSelection>({ agentId: "", llm: null, modelPresetId: null });

  onMount(() => ensureTasksStream());

  const urlAgentId = $derived(agentIdFromSearch(search));
  const effectiveAgentId = $derived(agentSelection.agentId.trim() || urlAgentId);
  const canSend = $derived(input.trim().length > 0 && Boolean(effectiveAgentId));
  const agentRunning = $derived(conversationHasRunningTask(conversationId));

  async function onSend(mode: MessageSendMode): Promise<void> {
    if (!canSend || sending) return;
    sending = true;
    const text = input.trim();
    const clientRequestId = crypto.randomUUID();
    const agentId = effectiveAgentId;
    const { llm, modelPresetId } = agentSelection;

    try {
      if (mode.enqueue && conversationId) {
        input = "";
        await sendMessageToConversation(
          conversationId,
          text,
          agentId,
          llm,
          modelPresetId,
          [],
          null,
          clientRequestId,
          { enqueue: true },
        );
        return;
      }

      if (!conversationId) {
        const created = await createConversation();
        const cid = String(created.id || "").trim();
        if (!cid) throw new Error("createConversation returned no id");
        retainChatSessionLive();
        getChatSessionStore(cid);
        input = "";
        await sendMessageToConversation(
          cid,
          text,
          agentId,
          llm,
          modelPresetId,
          [],
          null,
          clientRequestId,
          { steer: mode.steer },
        );
        replacePath(`/chat/${encodeURIComponent(cid)}${search}`);
        return;
      }

      if (!mode.enqueue) {
        const optimistic = appendOptimisticUserMessage({
          conversationId,
          text,
          agentId,
          llm: llm ?? undefined,
          modelPresetId,
        });
        if (!optimistic) throw new Error("appendOptimisticUserMessage failed");
        input = "";
        await sendMessageToConversation(
          conversationId,
          text,
          agentId,
          llm,
          modelPresetId,
          [],
          optimistic.parentId,
          optimistic.clientRequestId,
          { steer: mode.steer },
        );
      }
    } catch (err) {
      console.error("[ChatComposer] send failed", err);
      input = text;
      throw err;
    } finally {
      sending = false;
    }
  }
</script>

<MessageComposer
  value={input}
  onValueChange={(v) => (input = v)}
  {canSend}
  {agentRunning}
  {sending}
  onSend={onSend}
  onAgentSelectionChange={(sel) => (agentSelection = sel)}
>
  {#snippet queuedSlot()}
    {#if conversationId && pendingMessages.length > 0}
      <QueuedMessageChips
        messages={pendingMessages}
        onCancel={(clientRequestId) => void cancelPendingMessage(conversationId, clientRequestId)}
      />
    {/if}
  {/snippet}
</MessageComposer>
