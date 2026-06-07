<script lang="ts">
  import { getChatSessionContext } from "@/lib/chatSessionContext";
  import { notifyError } from "@/utils/toast";

  let { entryId }: { entryId: string } = $props();

  const session = getChatSessionContext();
  let switching = $state(false);

  const siblings = $derived(session.siblingsOf(entryId));
  const activeIndex = $derived(siblings.findIndex((s) => s.isChosen));
  const hasBranches = $derived(siblings.length > 1 && activeIndex >= 0);

  async function switchByOffset(offset: -1 | 1): Promise<void> {
    if (!hasBranches || switching) return;
    const nextIndex = (activeIndex + offset + siblings.length) % siblings.length;
    const sibling = siblings[nextIndex];
    if (!sibling) return;
    switching = true;
    try {
      await session.switchToBranch(sibling.id);
    } catch (e) {
      notifyError(`Failed to switch branch: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      switching = false;
    }
  }
</script>

{#if hasBranches}
  <div
    data-testid="branch-selector"
    class="inline-flex items-center gap-0.5 rounded bg-secondary/60 px-1 py-0.5 text-[10px] text-muted-foreground"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
    role="group"
  >
    <button
      type="button"
      disabled={switching}
      onclick={() => void switchByOffset(-1)}
      class="transition-colors hover:text-foreground disabled:opacity-50"
      aria-label="Previous branch"
    >
      <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m15 18-6-6 6-6" />
      </svg>
    </button>
    <span class="font-mono tabular-nums">{activeIndex + 1}/{siblings.length}</span>
    <button
      type="button"
      disabled={switching}
      onclick={() => void switchByOffset(1)}
      class="transition-colors hover:text-foreground disabled:opacity-50"
      aria-label="Next branch"
    >
      <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
  </div>
{/if}
