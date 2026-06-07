<script lang="ts">
  import type { UserMessageEntry } from "@/protocol/chatEntry";
  import { formatExactChatTime, formatRelativeChatTime } from "@/utils/formatRelativeChatTime";
  import ChatMessageShell from "../ChatMessageShell.svelte";

  let { entry }: { entry: UserMessageEntry } = $props();

  const relativeTime = $derived(formatRelativeChatTime(entry.createdAt));
  const exactTime = $derived(formatExactChatTime(entry.createdAt));
</script>

<ChatMessageShell role="user">
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
