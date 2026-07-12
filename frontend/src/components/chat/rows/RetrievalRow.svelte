<script lang="ts">
  import type { RetrievalEntry } from "@/protocol/chatEntry";
  import ChatThreadIndent from "../ChatThreadIndent.svelte";
  import RowIcon from "../RowIcon.svelte";

  let { entry }: { entry: RetrievalEntry } = $props();

  let toggled = $state<boolean | null>(null);
  const expanded = $derived(toggled ?? false);

  const summary = $derived.by(() => {
    // Preplanned mode appends the entry before its queries exist.
    if (entry.state === "pending" && entry.queries.length === 0) return "Planning retrieval…";
    if (entry.state === "pending") return "Retrieving…";
    if (entry.state === "failed") return "Retrieval failed";
    if (entry.hits.length === 0) return "Retrieval found nothing relevant";
    return `Retrieved ${entry.hits.length} excerpt${entry.hits.length === 1 ? "" : "s"}`;
  });
</script>

<ChatThreadIndent>
  {#snippet children()}
    <div class="overflow-hidden rounded-md border bg-secondary/50" data-testid="retrieval-row">
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-secondary"
        aria-expanded={expanded}
        onclick={() => (toggled = !expanded)}
      >
        <RowIcon name="chevron" class="h-3 w-3 shrink-0 text-muted-foreground {expanded ? 'rotate-90' : ''}" />
        <RowIcon
          name="file"
          class="h-3 w-3 shrink-0 {entry.state === 'failed' ? 'text-destructive' : 'text-primary'}"
        />
        <span class="font-medium text-foreground" data-testid="retrieval-summary">{summary}</span>
        <span class="min-w-0 truncate text-muted-foreground">{entry.storages.join(", ")}</span>
      </button>
      {#if expanded}
        <div class="animate-slide-in space-y-2 border-t px-3 py-2">
          {#each entry.queries as query, i (i)}
            <div class="text-[11px] text-muted-foreground">
              <span
                class="mr-1 rounded bg-muted px-1 py-px font-medium uppercase tracking-wide"
                data-testid="retrieval-query-origin">{query.origin}</span
              >
              query: <code class="text-secondary-foreground">{query.text}</code>
            </div>
          {/each}
          {#if entry.state === "failed"}
            <p class="text-[11px] text-destructive" data-testid="retrieval-error">
              {entry.error ?? "unknown error"}
            </p>
          {/if}
          {#each entry.hits as hit, i (i)}
            <div class="rounded border bg-background/60 px-2 py-1.5" data-testid="retrieval-hit">
              <div class="flex items-center gap-2 text-[11px]">
                <span
                  class="rounded px-1 py-px font-medium uppercase tracking-wide {hit.origin === 'graph'
                    ? 'bg-violet-500/15 text-violet-600'
                    : 'bg-teal-500/15 text-teal-600'}"
                >
                  {hit.origin}
                </span>
                <code class="min-w-0 truncate text-secondary-foreground" data-testid="retrieval-hit-source"
                  >{hit.source}</code
                >
                <span class="shrink-0 text-muted-foreground">{hit.storage} · {hit.score}</span>
              </div>
              <pre
                class="scrollbar-thin mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">{hit.text}</pre>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/snippet}
</ChatThreadIndent>
