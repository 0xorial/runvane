<script lang="ts">
  import { summarizeConversation } from "@/api/client";
  import { getChatSessionContext } from "@/lib/chatSessionContext";
  import { notifyError } from "@/utils/toast";

  let {
    conversationId,
    entryId,
  }: {
    conversationId: string;
    entryId: string;
  } = $props();

  const session = getChatSessionContext();
  let submitting = $state(false);

  const canFold = $derived.by(() => {
    const path = session.getActivePathEntries().map((row$) => row$.get());
    const idx = path.findIndex((e) => e.id === entryId);
    return idx > 0;
  });

  async function submit(): Promise<void> {
    if (submitting) return;
    submitting = true;
    try {
      await summarizeConversation(conversationId, { firstEntryToSummarize: entryId });
    } catch (error) {
      notifyError(`Failed to fold: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      submitting = false;
    }
  }
</script>

{#if canFold}
  <button
    type="button"
    data-testid="fold-from-here"
    class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    onclick={() => void submit()}
    disabled={submitting}
    title="Fold this message and everything after it into a summary"
    aria-label="Fold this message and everything after it"
  >
    <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
      <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
      <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
    </svg>
    {submitting ? "Folding…" : "Fold"}
  </button>
{/if}
