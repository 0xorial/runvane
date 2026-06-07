<script lang="ts">
  import type { AssistantMessageEntry } from "@/protocol/chatEntry";
  import { formatExactChatTime, formatRelativeChatTime } from "@/utils/formatRelativeChatTime";
  import ChatMessageShell from "../ChatMessageShell.svelte";

  let { entry }: { entry: AssistantMessageEntry } = $props();

  const relativeTime = $derived(formatRelativeChatTime(entry.createdAt));
  const exactTime = $derived(formatExactChatTime(entry.createdAt));
</script>

<ChatMessageShell role="agent">
  {#snippet badge()}
    {#if relativeTime}
      <span
        class="text-[11px] font-normal normal-case tracking-normal text-muted-foreground"
        title={exactTime || undefined}
      >
        {relativeTime}
      </span>
    {/if}
  {/snippet}
  {#snippet children()}
    {#if entry.text}
      <div class="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{entry.text}</div>
    {/if}
  {/snippet}
</ChatMessageShell>
