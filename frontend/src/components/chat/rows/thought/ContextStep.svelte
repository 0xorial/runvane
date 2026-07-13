<script lang="ts">
  import { reprocessThoughtContext } from "@/api/client";
  import type { ThoughtEntry } from "@/protocol/chatEntry";
  import ModelDropdown from "@/components/ui/ModelDropdown.svelte";
  import ZodJsonEditor from "@/components/ui/ZodJsonEditor.svelte";
  import { createLlmProvidersQuery } from "@/hooks/queries/referenceData";
  import { LlmRequestSchema } from "@/lib/editorSchemas";
  import { getChatSessionContext } from "@/lib/chatSessionContext";
  import { buildModelGroups } from "@/pages/settings/helpers";
  import ShiftEnterHint from "@/components/ui/ShiftEnterHint.svelte";
  import { notifyError } from "@/utils/toast";
  import ReadOnlySection from "../ReadOnlySection.svelte";

  let {
    entry,
    conversationId,
  }: {
    entry: ThoughtEntry;
    conversationId: string;
  } = $props();

  const session = getChatSessionContext();
  const providersQuery = createLlmProvidersQuery();
  const modelGroups = $derived(buildModelGroups(providersQuery.data ?? []));

  let isEditing = $state(false);
  let isSaving = $state(false);
  let promptValid = $state(false);

  const prompt = $derived((entry.llmRequest ?? "").trim());
  const currentProviderId = $derived(String(entry.llm?.providerId ?? "").trim());
  const currentModel = $derived(String(entry.llm?.model ?? "").trim());

  let editedPrompt = $state("");
  let selectedProviderId = $state("");
  let selectedModel = $state("");

  $effect(() => {
    if (isEditing) return;
    editedPrompt = prompt;
    selectedProviderId = currentProviderId;
    selectedModel = currentModel;
  });

  const canApply = $derived(
    promptValid && selectedProviderId.trim().length > 0 && selectedModel.trim().length > 0 && !isSaving,
  );
  const hasChanges = $derived(
    editedPrompt.trim() !== prompt ||
      selectedProviderId.trim() !== currentProviderId ||
      selectedModel.trim() !== currentModel,
  );

  async function applyEdit(): Promise<void> {
    if (!canApply) return;
    isSaving = true;
    try {
      const result = await reprocessThoughtContext(conversationId, entry.id, {
        editedRequestText: editedPrompt.trim(),
        llm: { providerId: selectedProviderId.trim(), model: selectedModel.trim() },
      });
      await session.setActiveLeaf(result.data.leafEntryId);
      isEditing = false;
    } catch (error) {
      notifyError(`Failed to reprocess context: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      isSaving = false;
    }
  }

  function cancelEdit(): void {
    editedPrompt = prompt;
    selectedProviderId = currentProviderId;
    selectedModel = currentModel;
    isEditing = false;
  }

  function cancelEditIfUnchanged(): void {
    if (!hasChanges) cancelEdit();
  }
</script>

<div class="mt-1.5 ml-1 space-y-2 text-xs">
  <div class="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
    <span>{currentProviderId && currentModel ? `model: ${currentProviderId}/${currentModel}` : "model: unknown"}</span>
    <button
      type="button"
      class="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      onclick={() => (isEditing = !isEditing)}
      title="Edit context and branch"
    >
      <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      </svg>
      {isEditing ? "Close edit" : "Edit"}
    </button>
  </div>
  {#if isEditing}
    <div class="space-y-1.5">
      <div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Model</div>
      <ModelDropdown
        value={selectedModel}
        onChange={(model, providerId) => {
          selectedModel = model;
          if (providerId) selectedProviderId = String(providerId).trim();
        }}
        groups={modelGroups}
      />
      <div class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Prompt</div>
      <ZodJsonEditor
        schema={LlmRequestSchema}
        value={editedPrompt}
        onchange={(v: string) => (editedPrompt = v)}
        onValidityChange={(v: boolean) => (promptValid = v)}
        height={440}
        resizable
        onSubmitShortcut={() => void applyEdit()}
        onEscapeShortcut={cancelEditIfUnchanged}
      />
      <div class="flex justify-end gap-1.5">
        <button
          type="button"
          class="rounded border border-border/70 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
          onclick={cancelEdit}
          disabled={isSaving}
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="thought-context-apply"
          class="inline-flex items-center gap-1.5 rounded border border-primary/50 px-2 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Apply context edit (Shift+Enter)"
          onclick={() => void applyEdit()}
          disabled={!canApply}
        >
          {#if isSaving}
            Applying…
          {:else}
            Apply
            <ShiftEnterHint />
          {/if}
        </button>
      </div>
    </div>
  {:else}
    <ReadOnlySection label="Prompt" value={prompt} />
  {/if}
</div>
