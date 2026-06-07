<script lang="ts">
  import { reprocessThought, reprocessThoughtContext } from "@/api/client";
  import type { ThoughtPrepareEntry, ThoughtStreamEntry } from "@/protocol/chatEntry";
  import CodeEditor from "@/components/ui/CodeEditor.svelte";
  import ZodJsonEditor from "@/components/ui/ZodJsonEditor.svelte";
  import { AgenticPlannerOutputSchema } from "@/lib/editorSchemas";
  import { getChatSessionContext } from "@/lib/chatSessionContext";
  import { formatTokenCount } from "@/utils/formatTokenCount";
  import { notifyError } from "@/utils/toast";
  import { displayStatus } from "./meta";
  import ReadOnlySection from "../ReadOnlySection.svelte";

  let {
    stream,
    prepareEntry,
    conversationId,
  }: {
    stream: ThoughtStreamEntry;
    prepareEntry: ThoughtPrepareEntry;
    conversationId: string;
  } = $props();

  const session = getChatSessionContext();

  const response = $derived(String(stream.llmResponse || "").trim());
  const thinking = $derived(String(stream.thinkingText || "").trim());

  let isEditing = $state(false);
  let isSaving = $state(false);
  let isRetrying = $state(false);
  let editedResponse = $state("");

  $effect(() => {
    if (!isEditing) editedResponse = response;
  });

  const promptTokens = $derived(stream.promptTokens ?? 0);
  const cachedPromptTokens = $derived(stream.cachedPromptTokens ?? 0);
  const completionTokens = $derived(stream.completionTokens ?? 0);
  const duration = $derived(stream.thoughtMs != null ? `${Math.round(stream.thoughtMs)}ms` : "running");
  const statusLabel = $derived(displayStatus(stream.status ?? "running"));
  const canEdit = $derived(response.length > 0);
  const canApply = $derived(editedResponse.trim().length > 0 && !isSaving);
  const canRetry = $derived(stream.status === "failed" || stream.status === "cancelled");

  async function applyEdit(): Promise<void> {
    if (!canApply) return;
    isSaving = true;
    try {
      const result = await reprocessThought(conversationId, stream.id, editedResponse.trim());
      await session.setActiveLeaf(result.data.leafEntryId);
      isEditing = false;
    } catch (error) {
      notifyError(`Failed to reprocess thought: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      isSaving = false;
    }
  }

  async function retry(): Promise<void> {
    if (isRetrying) return;
    const requestText = String(prepareEntry.requestText ?? stream.llmRequest ?? "").trim();
    const providerId = String(prepareEntry.llm?.providerId ?? stream.llm?.providerId ?? "").trim();
    const model = String(prepareEntry.llm?.model ?? stream.llm?.model ?? "").trim();
    if (!requestText || !providerId || !model) {
      notifyError("Cannot retry: original request, provider, or model is missing.");
      return;
    }
    isRetrying = true;
    try {
      const result = await reprocessThoughtContext(conversationId, prepareEntry.id, {
        editedRequestText: requestText,
        llm: { providerId, model },
      });
      await session.setActiveLeaf(result.data.leafEntryId);
    } catch (error) {
      notifyError(`Failed to retry thought: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      isRetrying = false;
    }
  }
</script>

<div class="mt-1.5 ml-1 space-y-2 text-xs">
  <div class="flex items-start justify-between gap-2">
    <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
      {#if statusLabel}<span>status: {statusLabel}</span>{/if}
      <span>prompt: {formatTokenCount(promptTokens)}</span>
      <span>cached: {formatTokenCount(cachedPromptTokens)}</span>
      <span>completion: {formatTokenCount(completionTokens)}</span>
      <span>duration: {duration}</span>
    </div>
    <div class="ml-auto flex items-center gap-1">
      {#if canRetry}
        <button
          type="button"
          class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          onclick={() => void retry()}
          disabled={isRetrying}
          title="Retry with the same request"
        >
          <svg class="h-3 w-3 {isRetrying ? 'animate-spin' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" />
          </svg>
          {isRetrying ? "Retrying…" : "Retry"}
        </button>
      {/if}
      {#if canEdit}
        <button
          type="button"
          class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          onclick={() => (isEditing = !isEditing)}
          title="Edit reasoning and branch"
        >
          <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
          </svg>
          {isEditing ? "Close edit" : "Edit"}
        </button>
      {/if}
    </div>
  </div>
  {#if isEditing}
    <div class="space-y-1.5">
      <div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Edit response</div>
      {#if stream.type === "planner_llm_stream"}
        <ZodJsonEditor
          schema={AgenticPlannerOutputSchema}
          value={editedResponse}
          onchange={(v: string) => (editedResponse = v)}
          height={260}
          onSubmitShortcut={() => void applyEdit()}
        />
      {:else}
        <CodeEditor
          value={editedResponse}
          onchange={(v: string) => (editedResponse = v)}
          language="json"
          height={260}
          onSubmitShortcut={() => void applyEdit()}
        />
      {/if}
      <div class="flex justify-end gap-1.5">
        <button
          type="button"
          class="rounded border border-border/70 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
          onclick={() => {
            editedResponse = response;
            isEditing = false;
          }}
          disabled={isSaving}
        >
          Cancel
        </button>
        <button
          type="button"
          class="rounded border border-primary/50 px-2 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
          onclick={() => void applyEdit()}
          disabled={!canApply}
        >
          {isSaving ? "Applying…" : "Apply"}
        </button>
      </div>
    </div>
  {:else}
    {#if thinking}<ReadOnlySection label="Thinking" value={thinking} />{/if}
    <ReadOnlySection label="Raw response" value={response} />
  {/if}
  {#if stream.status === "failed" || stream.status === "cancelled"}
    <ReadOnlySection label="Error" value={String(stream.error || "")} danger />
  {/if}
</div>
