<script lang="ts">
  import { reprocessThoughtContext } from "@/api/client";
  import type { ThoughtEntry } from "@/protocol/chatEntry";
  import ModelDropdown from "@/components/ui/ModelDropdown.svelte";
  import { createLlmProvidersQuery } from "@/hooks/queries/referenceData";
  import { getChatSessionContext } from "@/lib/chatSessionContext";
  import { buildModelGroups } from "@/pages/settings/helpers";
  import HintTooltip from "@/components/ui/HintTooltip.svelte";
  import { notifyError } from "@/utils/toast";

  const HINT = "Try with different model";

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

  let pickerOpen = $state(false);
  let isRebranching = $state(false);
  // Scope of the model override: true (default) threads it through the whole
  // turn like a user-message override; false runs only this one LLM call on it.
  let applyDownstream = $state(true);

  const requestText = $derived((entry.llmRequest ?? "").trim());
  const canRebranch = $derived(requestText.length > 0 && !isRebranching);

  async function rebranchWithModel(model: string, providerId: string | undefined): Promise<void> {
    const pid = String(providerId ?? "").trim();
    const modelName = String(model ?? "").trim();
    if (!pid || !modelName || !requestText) return;
    pickerOpen = false;
    isRebranching = true;
    try {
      // Model-only branch: send just the new model. The server re-runs the
      // thought's stored context — no need to round-trip the whole thing.
      const result = await reprocessThoughtContext(conversationId, entry.id, {
        llm: { providerId: pid, model: modelName },
        applyDownstream,
      });
      await session.setActiveLeaf(result.data.leafEntryId);
    } catch (error) {
      notifyError(`Failed to branch with model: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      isRebranching = false;
    }
  }
</script>

<div class="relative inline-flex items-center">
  <HintTooltip content={HINT} side="top">
    <button
      type="button"
      data-testid="thought-try-model"
      class="inline-flex items-center gap-0.5 rounded bg-secondary/60 px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 {!canRebranch ? 'pointer-events-none' : ''}"
      aria-label={HINT}
      disabled={!canRebranch}
      onclick={(e) => {
        e.stopPropagation();
        pickerOpen = !pickerOpen;
      }}
    >
      <svg class="h-3 w-3 {isRebranching ? 'animate-spin' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </svg>
    </button>
  </HintTooltip>
  {#if pickerOpen}
    <div class="absolute right-0 top-full z-20 mt-1 w-56" role="presentation" onclick={(e) => e.stopPropagation()}>
      <ModelDropdown
        value=""
        placeholder="Choose model…"
        searchPlaceholder="Search model"
        initialOpen={true}
        groups={modelGroups}
        disabled={isRebranching}
        buttonClass="min-h-[26px] text-xs"
        onOpenChange={(open) => {
          if (!open) pickerOpen = false;
        }}
        onChange={(model, providerId) => void rebranchWithModel(model, providerId)}
      >
        {#snippet header()}
          <div class="flex rounded-md border border-border/70 p-0.5 text-[11px]">
            <button
              type="button"
              data-testid="try-model-scope-downstream"
              class="flex-1 rounded px-2 py-1 transition-colors {applyDownstream ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}"
              title="The chosen model threads through the rest of this turn, like setting it on the user message."
              onclick={() => (applyDownstream = true)}
            >
              Downstream
            </button>
            <button
              type="button"
              data-testid="try-model-scope-single"
              class="flex-1 rounded px-2 py-1 transition-colors {applyDownstream ? 'text-muted-foreground hover:text-foreground' : 'bg-secondary font-medium text-foreground'}"
              title="Only this single LLM call uses the chosen model; the continuation reverts to the inherited model."
              onclick={() => (applyDownstream = false)}
            >
              This call
            </button>
          </div>
        {/snippet}
      </ModelDropdown>
    </div>
  {/if}
</div>
