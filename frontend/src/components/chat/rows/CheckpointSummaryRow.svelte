<script lang="ts">
  import type { CheckpointSummaryEntry } from "@/protocol/chatEntry";
  import CollapsibleBlock from "@/components/ui/CollapsibleBlock.svelte";
  import CopyButton from "@/components/ui/CopyButton.svelte";
  import MarkdownContent from "@/components/ui/MarkdownContent.svelte";
  import { getChatSessionContext } from "@/lib/chatSessionContext";
  import { formatTokenCount } from "@/utils/formatTokenCount";
  import { notifyError } from "@/utils/toast";
  import { formatExactChatTime, formatRelativeChatTime } from "@/utils/formatRelativeChatTime";
  import BranchSelector from "../BranchSelector.svelte";
  import ChatMessageShell from "../ChatMessageShell.svelte";

  let { entry }: { entry: CheckpointSummaryEntry } = $props();

  const session = getChatSessionContext();
  let switching = $state(false);

  const relativeTime = $derived(formatRelativeChatTime(entry.createdAt));
  const exactTime = $derived(formatExactChatTime(entry.createdAt));
  const rangeInputTokens = $derived(entry.rangeInputTokens ?? 0);
  const summaryTokens = $derived(entry.summaryTokens ?? 0);
  const entryCount = $derived(entry.rangeEntryCount);
  const hasStats = $derived(entryCount !== undefined);
  const hasTokens = $derived(rangeInputTokens > 0);

  async function viewOriginal(): Promise<void> {
    if (switching) return;
    switching = true;
    try {
      await session.switchToBranch(entry.summarizedRange.fromEntryId);
    } catch (err) {
      notifyError(`Failed to switch branch: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      switching = false;
    }
  }
</script>

<ChatMessageShell role="agent">
  {#snippet badge()}
    <div class="flex items-center gap-1">
      <span class="inline-flex items-center gap-1 rounded bg-secondary/60 px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
        <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
          <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
          <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
          <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
        </svg>
        folded
      </span>
      <button
        type="button"
        disabled={switching}
        onclick={(e) => {
          e.stopPropagation();
          void viewOriginal();
        }}
        class="inline-flex items-center gap-1 rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
      >
        <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
          <line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        View original
      </button>
      <BranchSelector entryId={entry.id} />
      {#if relativeTime}
        <span
          class="text-[11px] font-normal normal-case tracking-normal text-muted-foreground"
          title={exactTime || undefined}
        >
          {relativeTime}
        </span>
      {/if}
      {#if entry.summaryText}
        <CopyButton value={entry.summaryText} title="Copy summary" />
      {/if}
    </div>
  {/snippet}
  {#snippet children()}
    <div class="space-y-1">
      <div class="text-[11px] text-muted-foreground">
        {#if hasStats}
          <span>
            Summary of {entryCount} {entryCount === 1 ? "entry" : "entries"}
            {#if hasTokens}
              · {formatTokenCount(rangeInputTokens)} → {formatTokenCount(summaryTokens)}
            {/if}
          </span>
        {:else}
          <span>Summary of earlier turns</span>
        {/if}
      </div>
      {#if entry.summaryText}
        <CollapsibleBlock>
          <MarkdownContent content={entry.summaryText} />
        </CollapsibleBlock>
      {/if}
    </div>
  {/snippet}
</ChatMessageShell>
