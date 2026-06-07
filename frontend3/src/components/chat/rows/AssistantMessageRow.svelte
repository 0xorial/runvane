<script lang="ts">
  import type { AssistantMessageEntry } from "@/protocol/chatEntry";
  import CopyButton from "@/components/ui/CopyButton.svelte";
  import MarkdownContent from "@/components/ui/MarkdownContent.svelte";
  import { formatExactChatTime, formatRelativeChatTime } from "@/utils/formatRelativeChatTime";
  import BranchSelector from "../BranchSelector.svelte";
  import ChatMessageShell from "../ChatMessageShell.svelte";
  import FoldFromHereButton from "./FoldFromHereButton.svelte";

  let {
    entry,
    conversationId,
  }: {
    entry: AssistantMessageEntry;
    conversationId: string;
  } = $props();

  const relativeTime = $derived(formatRelativeChatTime(entry.createdAt));
  const exactTime = $derived(formatExactChatTime(entry.createdAt));
</script>

<ChatMessageShell role="agent">
  {#snippet badge()}
    <div class="flex items-center gap-1">
      {#if relativeTime}
        <span
          class="text-[11px] font-normal normal-case tracking-normal text-muted-foreground"
          title={exactTime || undefined}
        >
          {relativeTime}
        </span>
      {/if}
      <BranchSelector entryId={entry.id} />
      <FoldFromHereButton {conversationId} entryId={entry.id} />
      {#if entry.text}
        <CopyButton value={entry.text} title="Copy message" />
      {/if}
    </div>
  {/snippet}
  {#snippet children()}
    {#if entry.text}
      <MarkdownContent content={entry.text} />
    {/if}
  {/snippet}
</ChatMessageShell>
