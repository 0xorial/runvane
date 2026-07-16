<script lang="ts">
  import { cancelPendingMessage, createConversation, uploadFile } from "@/api/client";
  import type { ChatAttachment } from "@/protocol/chatEntry";
  import type { LlmRef } from "../../../../backend/src/contracts/llm";
  import { getChatSessionStore, retainChatSessionLive } from "@/lib/chatSessionRegistry";
  import type { OptimisticUserMessage } from "@/lib/chatSessionState.svelte";
  import { conversationHasRunningTask, ensureTasksStream } from "@/lib/tasksStore.svelte";
  import { agentIdFromSearch, replacePath, toolSandboxIdFromSearch } from "@/lib/router";
  import { onDestroy, onMount } from "svelte";
  import type { ChatAgentSelection } from "./ChatAgentToolbar.svelte";
  import AttachmentChips, { type SelectedAttachment } from "./AttachmentChips.svelte";
  import MessageComposer from "./MessageComposer.svelte";
  import QueuedMessageChips from "./QueuedMessageChips.svelte";
  import type { PendingMessage } from "@/lib/chatSessionStore";
  import { compileUserMessageOverrides, EMPTY_CONTEXT_FILES_DRAFT, EMPTY_KNOWLEDGE_DRAFT } from "@/lib/chatToolOverrides";
  import {
    getChatContextFilesDraft,
    getChatKnowledgeDraft,
    getChatToolDraft,
    setChatContextFilesDraft,
    setChatKnowledgeDraft,
  } from "@/lib/chatToolDraft.svelte";
  import ContextInjectionBar from "./ContextInjectionBar.svelte";
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
    /** Fired once per direct send; `sentRowId` may be a placeholder that only
     * resolves to a transcript row after the SSE snapshot (new conversations). */
    onSent?: (sentRowId: string, conversationId: string) => void;
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

  // Preview object URLs, cached per File: entry updates (mode flips, measured
  // dims/pages) must NOT recreate them — revoking an URL an <img>/<iframe> is
  // still loading aborts that request. Only files actually removed get their
  // URL revoked (plus everything on unmount).
  let previewUrlCache = new Map<File, string>();
  $effect(() => {
    const files = selectedFiles.map(({ file }) => file);
    const next = new Map<File, string>();
    for (const file of files) {
      if (next.has(file)) continue;
      const cached = previewUrlCache.get(file);
      if (cached !== undefined) {
        next.set(file, cached);
        continue;
      }
      const previewable = file.type.startsWith("image/") || file.type === "application/pdf";
      next.set(file, previewable ? URL.createObjectURL(file) : "");
    }
    for (const [file, url] of previewUrlCache) {
      if (!next.has(file) && url) URL.revokeObjectURL(url);
    }
    previewUrlCache = next;
    previewUrls = files.map((file) => next.get(file) ?? "");
  });

  onDestroy(() => {
    for (const url of previewUrlCache.values()) {
      if (url) URL.revokeObjectURL(url);
    }
  });

  function addFiles(files: File[]): void {
    if (files.length === 0) return;
    const wrapped = files.map((file) => ({ file, mode: defaultAttachmentMode(file) }));
    selectedFiles = [...selectedFiles, ...wrapped];
    for (const entry of wrapped) {
      measureImage(entry.file);
      sniffPdfPages(entry.file);
    }
  }

  /** The vision-token estimate needs pixel dimensions; measured once per
   * added image and stamped onto its entry (matched by File identity so a
   * mode flip in the meantime doesn't lose the result). */
  function measureImage(file: File): void {
    if (!file.type.startsWith("image/")) return;
    createImageBitmap(file).then(
      (bitmap) => {
        const imageDims = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        selectedFiles = selectedFiles.map((x) => (x.file === file ? { ...x, imageDims } : x));
      },
      () => {
        /* undecodable image — stays an at-send unknown */
      },
    );
  }

  /** The per-page document estimate needs a page count. Sniffed from the raw
   * bytes: count `/Type /Page` object markers; PDFs using compressed object
   * streams hide them, so fall back to a size heuristic (~60KB/page). Rough
   * on purpose — the estimate is labeled "~". */
  function sniffPdfPages(file: File): void {
    if (file.type !== "application/pdf" || file.size > 25_000_000) return;
    file.arrayBuffer().then(
      (buf) => {
        const raw = new TextDecoder("latin1").decode(buf);
        const markers = raw.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
        const pdfPageCount = markers > 0 ? markers : Math.max(1, Math.ceil(file.size / 60_000));
        selectedFiles = selectedFiles.map((x) => (x.file === file ? { ...x, pdfPageCount } : x));
      },
      () => {
        /* unreadable — stays an at-send unknown */
      },
    );
  }

  /** Forced retrieval and file attaches are single-shot: they apply to the
   * message just sent and switch themselves off, instead of persisting as a
   * policy for the chat. */
  function consumeSingleShotDrafts(): void {
    if (getChatKnowledgeDraft().enabled) setChatKnowledgeDraft({ ...EMPTY_KNOWLEDGE_DRAFT });
    const filesDraft = getChatContextFilesDraft();
    if (filesDraft.touched || filesDraft.paths.length > 0) {
      setChatContextFilesDraft({ ...EMPTY_CONTEXT_FILES_DRAFT });
    }
  }

  async function onSend(mode: MessageSendMode): Promise<void> {
    if (!canSend || sending) return;
    sending = true;
    const text = input.trim();
    const clientRequestId = crypto.randomUUID();
    const agentId = effectiveAgentId;
    const { llm, modelPresetId } = agentSelection;
    const overrides = compileUserMessageOverrides(
      getChatToolDraft(),
      getChatKnowledgeDraft(),
      getChatContextFilesDraft(),
    );
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
        consumeSingleShotDrafts();
        return;
      }

      if (!conversationId) {
        const created = await createConversation({
          toolSandboxId: toolSandboxIdFromSearch(search) || undefined,
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
        consumeSingleShotDrafts();
        onSent?.(`sent-${clientRequestId}`, cid);
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
        onSent?.(optimistic.rowId, conversationId);
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
        consumeSingleShotDrafts();
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
  {#snippet contextSlot(text: string)}
    <ContextInjectionBar
      {text}
      agentId={effectiveAgentId}
      {conversationId}
      toolSandboxId={toolSandboxIdFromSearch(search) || "local"}
      attachments={selectedFiles}
      llm={agentSelection.llm}
    />
  {/snippet}
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
