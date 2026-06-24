<script lang="ts">
  import { splitConversation } from "@/api/client";
  import { getChatSessionContext } from "@/lib/chatSessionContext";
  import { queryClient } from "@/lib/queryClient";
  import { queryKeys } from "@/hooks/queries/keys";
  import { upsertConversationInList } from "@/hooks/queries/conversations";
  import { navigate } from "@/lib/router";
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

  // Splitting at the very first message would just move the whole conversation,
  // so only offer it once there's an earlier message to leave behind.
  const canSplit = $derived.by(() => {
    const path = session.getActivePathEntries().map((row$) => row$.get());
    const idx = path.findIndex((e) => e.id === entryId);
    return idx > 0;
  });

  async function submit(): Promise<void> {
    if (submitting) return;
    submitting = true;
    try {
      const created = await splitConversation(conversationId, entryId);
      // Seed the caches so the destination renders (incl. its "forked from"
      // banner) immediately, before the SSE create event arrives.
      queryClient.setQueryData(queryKeys.conversation(created.id), created);
      upsertConversationInList(false, created);
      navigate(`/chat/${created.id}`);
    } catch (error) {
      notifyError(`Failed to split: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      submitting = false;
    }
  }
</script>

{#if canSplit}
  <button
    type="button"
    data-testid="split-from-here"
    class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    onclick={() => void submit()}
    disabled={submitting}
    title="Move this message and everything after it into a new conversation"
    aria-label="Split into a new conversation from here"
  >
    <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M6 8.5v7" />
      <path d="M18 10.5a6 6 0 0 1-6 6H8.5" />
    </svg>
    {submitting ? "Splitting…" : "Split"}
  </button>
{/if}
