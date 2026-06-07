<script lang="ts">
  import type { ChatEntry } from "@/protocol/chatEntry";

  let {
    entry,
    conversationId,
  }: {
    entry: ChatEntry;
    conversationId: string;
  } = $props();
</script>

{#if entry.type === "user-message"}
  <div class="mb-3 rounded-lg bg-primary/10 px-3 py-2 text-sm text-foreground">{entry.text}</div>
{:else if entry.type === "thought-prepare"}
  <div class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{entry.title}</div>
{:else if entry.type === "assistant-message"}
  <div class="mb-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{entry.text}</div>
{:else if entry.type === "tool-invocation"}
  <div class="mb-2 font-mono text-xs text-muted-foreground">
    {entry.toolId}({JSON.stringify(entry.parameters ?? {})})
  </div>
{:else if entry.type === "checkpoint-summary"}
  <div class="mb-2 text-xs italic text-muted-foreground">{entry.summaryText}</div>
{/if}
