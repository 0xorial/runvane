<script lang="ts">
  import { isThoughtStreamEntry, type ChatEntry } from "@/protocol/chatEntry";
  import type { ThoughtTripletRefs } from "@/lib/thoughtTriplets";
  import type { ObservableItem } from "@/utils/observableCollection";

  let {
    entry,
    conversationId,
    thoughtTripletsById,
  }: {
    entry: ChatEntry;
    conversationId: string;
    thoughtTripletsById: ReadonlyMap<string, ThoughtTripletRefs>;
  } = $props();

  function streamText(streamEntry$: ObservableItem<ChatEntry> | undefined): string {
    if (!streamEntry$) return "";
    const stream = streamEntry$.get();
    return isThoughtStreamEntry(stream) ? String(stream.llmResponse ?? "") : "";
  }
</script>

{#if entry.type === "user-message"}
  <div class="mb-3 rounded-lg bg-primary/10 px-3 py-2 text-sm text-foreground">{entry.text}</div>
{:else if entry.type === "thought-prepare"}
  {@const refs = thoughtTripletsById.get(entry.thoughtId)}
  <div class="mb-2 border-l-2 border-border/60 pl-3">
    <div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{entry.title}</div>
    {#if refs?.streamEntry$}
      {@const text = streamText(refs.streamEntry$)}
      {#if text}
        <div class="mt-1 whitespace-pre-wrap text-sm text-foreground">{text}</div>
      {/if}
    {/if}
  </div>
{:else if entry.type === "assistant-message"}
  <div class="mb-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{entry.text}</div>
{:else if entry.type === "tool-invocation"}
  <div class="mb-2 font-mono text-xs text-muted-foreground">
    {entry.toolId}({JSON.stringify(entry.parameters ?? {})})
  </div>
{:else if entry.type === "checkpoint-summary"}
  <div class="mb-2 text-xs italic text-muted-foreground">{entry.summaryText}</div>
{/if}
