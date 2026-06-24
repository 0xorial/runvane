<script lang="ts">
  import { cancelPendingMessage, createConversation, uploadFile } from "@/api/client";
  import type { ChatAttachment } from "@/protocol/chatEntry";
  import type { LlmRef } from "../../../../backend/src/contracts/llm";
  import { getChatSessionStore, retainChatSessionLive } from "@/lib/chatSessionRegistry";
  import type { OptimisticUserMessage } from "@/lib/chatSessionState.svelte";
  import { conversationHasRunningTask, ensureTasksStream } from "@/lib/tasksStore.svelte";
  import { agentIdFromSearch, replacePath, toolEnvironmentIdFromSearch } from "@/lib/router";
  import { onMount } from "svelte";
  import type { ChatAgentSelection } from "./ChatAgentToolbar.svelte";
  import AttachmentChips, { type SelectedAttachment } from "./AttachmentChips.svelte";
  import MessageComposer from "./MessageComposer.svelte";
  import QueuedMessageChips from "./QueuedMessageChips.svelte";
  import type { PendingMessage } from "@/lib/chatSessionStore";
  import { compileUserMessageOverrides } from "@/lib/chatToolOverrides";
  import { getChatToolDraft } from "@/lib/chatToolDraft.svelte";
  import { defaultAttachmentMode, sendMessageToConversation, type MessageSendMode } from "./sendMessage";

  let {
    conversationId,
    pathPlannerLlm = null,
    search,
    pendingMessages = [],
    appendOptimisticUserMessage,
    onSent,
    textareaRef = $bindable(null),
  }: {
    conversationId: string | null;
    pathPlannerLlm?: LlmRef | null;
    search: string;
    pendingMessages?: PendingMessage[];
    appendOptimisticUserMessage: (input: {
      conversationId: string;
      text: string;
      agentId: string;
      llm?: LlmRef;
      modelPresetId?: number | null;
      attachments?: ChatAttachment[];
    }) => OptimisticUserMessage | null;
    onSent?: (optimisticRowId: string) => void;
    textareaRef?: HTMLTextAreaElement | null;
  } = $props();

  let input = $state("");
  let sending = $state(false);
  let selectedFiles = $state<SelectedAttachment[]>([]);
  let previewUrls = $state<string[]>([]);
  let agentSelection = $state<ChatAgentSelection>({ agentId: "", llm: null, modelPresetId: null });

  onMount(() => ensureTasksStream());

  const urlAgentId = $derived(agentIdFromSearch(search));
  const effectiveAgentId = $derived(agentSelection.agentId.trim() || urlAgentId);
  const canSend = $derived((input.trim().length > 0 || selectedFiles.length > 0) && Boolean(effectiveAgentId));
  const agentRunning = $derived(conversationHasRunningTask(conversationId));

  $effect(() => {
    const urls = selectedFiles.map(({ file }) =>
      file.type.startsWith("image/") || file.type === "application/pdf" ? URL.createObjectURL(file) : "",
    );
    previewUrls = urls;
    return () => {
      for (const url of urls) {
        if (url) URL.revokeObjectURL(url);
      }
    };
  });

  function addFiles(files: File[]): void {
    if (files.length === 0) return;
    const wrapped = files.map((file) => ({ file, mode: defaultAttachmentMode(file) }));
    selectedFiles = [...selectedFiles, ...wrapped];
  }

  async function onSend(mode: MessageSendMode): Promise<void> {
    if (!canSend || sending) return;
    sending = true;
    const text = input.trim();
    const clientRequestId = crypto.randomUUID();
    const agentId = effectiveAgentId;
    const { llm, modelPresetId } = agentSelection;
    const overrides = compileUserMessageOverrides(getChatToolDraft());
    const sendOpts = {
      ...(mode.steer ? { steer: true as const } : {}),
      ...(mode.enqueue ? { enqueue: true as const } : {}),
      ...(overrides ? { overrides } : {}),
    };

    try {
      const uploadedAttachments: ChatAttachment[] = [];
      for (const { file, mode: attachmentMode } of selectedFiles) {
        const uploaded = await uploadFile(file);
        uploadedAttachments.push({ ...uploaded.attachment, mode: attachmentMode });
      }
      const postAttachments = uploadedAttachments.map((x) => ({ id: x.id, mode: x.mode }));

      if (mode.enqueue && conversationId) {
        input = "";
        selectedFiles = [];
        await sendMessageToConversation(
          conversationId,
          text,
          agentId,
          llm,
          modelPresetId,
          postAttachments,
          null,
          clientRequestId,
          sendOpts,
        );
        return;
      }

      if (!conversationId) {
        const created = await createConversation({
          toolEnvironmentId: toolEnvironmentIdFromSearch(search) || undefined,
        });
        const cid = String(created.id || "").trim();
        if (!cid) throw new Error("createConversation returned no id");
        retainChatSessionLive();
        getChatSessionStore(cid);
        input = "";
        selectedFiles = [];
        await sendMessageToConversation(
          cid,
          text,
          agentId,
          llm,
          modelPresetId,
          postAttachments,
          null,
          clientRequestId,
          sendOpts,
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
          attachments: uploadedAttachments,
        });
        if (!optimistic) throw new Error("appendOptimisticUserMessage failed");
        onSent?.(optimistic.rowId);
        input = "";
        selectedFiles = [];
        await sendMessageToConversation(
          conversationId,
          text,
          agentId,
          llm,
          modelPresetId,
          postAttachments,
          optimistic.parentId,
          optimistic.clientRequestId,
          sendOpts,
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
  bind:textareaRef
  {conversationId}
  {pathPlannerLlm}
  value={input}
  onValueChange={(v) => (input = v)}
  {canSend}
  {agentRunning}
  {sending}
  onSend={onSend}
  onAgentSelectionChange={(sel) => (agentSelection = sel)}
  onPasteFiles={addFiles}
  onFileInputChange={addFiles}
>
  {#snippet queuedSlot()}
    {#if conversationId && pendingMessages.length > 0}
      <QueuedMessageChips
        messages={pendingMessages}
        onCancel={(clientRequestId) => void cancelPendingMessage(conversationId, clientRequestId)}
      />
    {/if}
  {/snippet}
  {#snippet attachmentsSlot()}
    {#if selectedFiles.length > 0}
      <AttachmentChips
        files={selectedFiles}
        {previewUrls}
        onChangeMode={(idx, next) => {
          selectedFiles = selectedFiles.map((entry, x) => (x === idx ? { ...entry, mode: next } : entry));
        }}
        onRemove={(idx) => {
          selectedFiles = selectedFiles.filter((_, x) => x !== idx);
        }}
      />
    {/if}
  {/snippet}
</MessageComposer>
