<script lang="ts">
  import type { ContextInjectionEntry } from "@/protocol/chatEntry";
  import ChatThreadIndent from "../ChatThreadIndent.svelte";
  import RowIcon from "../RowIcon.svelte";

  // One context-injection row for both sources: `files` (context files folded
  // in) and `rag` (retrieval over knowledge storages). The two testids are
  // preserved source-derived so the existing e2e selectors keep working.
  let { entry }: { entry: ContextInjectionEntry } = $props();

  let toggled = $state<boolean | null>(null);
  const expanded = $derived(toggled ?? false);

  const isRag = $derived(entry.source === "rag");
  const files = $derived(entry.files ?? []);
  const queries = $derived(entry.queries ?? []);
  const hits = $derived(entry.hits ?? []);
  const storages = $derived(entry.storages ?? []);

  const injectedFiles = $derived(files.filter((f) => f.status === "injected"));

  const summary = $derived.by(() => {
    if (isRag) {
      // Preplanned mode appends the entry before its queries exist.
      if (entry.state === "pending" && queries.length === 0) return "Planning retrieval…";
      if (entry.state === "pending") return "Retrieving…";
      if (entry.state === "failed") return "Retrieval failed";
      if (hits.length === 0) return "Retrieval found nothing relevant";
      return `Retrieved ${hits.length} excerpt${hits.length === 1 ? "" : "s"}`;
    }
    return injectedFiles.length > 0
      ? `Injected ${injectedFiles.length} context file${injectedFiles.length === 1 ? "" : "s"}`
      : "No context files found";
  });

  const failed = $derived(isRag && entry.state === "failed");
</script>

<ChatThreadIndent>
  {#snippet children()}
    <div
      class="overflow-hidden rounded-md border bg-secondary/50"
      data-testid={isRag ? "retrieval-row" : "context-injection-row"}
    >
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-secondary"
        aria-expanded={expanded}
        onclick={() => (toggled = !expanded)}
      >
        <RowIcon name="chevron" class="h-3 w-3 shrink-0 text-muted-foreground {expanded ? 'rotate-90' : ''}" />
        <RowIcon name="file" class="h-3 w-3 shrink-0 {failed ? 'text-destructive' : 'text-primary'}" />
        <span class="font-medium text-foreground" data-testid={isRag ? "retrieval-summary" : undefined}>{summary}</span>
        {#if isRag}
          <span class="min-w-0 truncate text-muted-foreground">{storages.join(", ")}</span>
        {/if}
      </button>
      {#if expanded}
        {#if isRag}
          <div class="animate-slide-in space-y-2 border-t px-3 py-2">
            {#each queries as query, i (i)}
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
            {#each hits as hit, i (i)}
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
        {:else if files.length > 0}
          <div class="animate-slide-in space-y-1 border-t px-3 py-2">
            {#each files as file (file.path)}
              <div class="flex items-center gap-2 text-[11px]">
                <span
                  class="rounded px-1 py-px font-medium uppercase tracking-wide {file.status === 'injected'
                    ? 'bg-teal-500/15 text-teal-600'
                    : 'bg-muted text-muted-foreground'}"
                >
                  {file.status}
                </span>
                <code class="text-secondary-foreground">{file.path}</code>
                <span class="text-muted-foreground">({file.fileType})</span>
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  {/snippet}
</ChatThreadIndent>
