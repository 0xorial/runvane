<script lang="ts">
  import type { ContextInjectionEntry } from "@/protocol/chatEntry";
  import ChatThreadIndent from "../ChatThreadIndent.svelte";
  import RowIcon from "../RowIcon.svelte";

  let { entry }: { entry: ContextInjectionEntry } = $props();

  let toggled = $state<boolean | null>(null);
  const expanded = $derived(toggled ?? false);

  const injected = $derived(entry.files.filter((f) => f.status === "injected"));
  const summary = $derived(
    injected.length > 0
      ? `Preinjected ${injected.length} file${injected.length === 1 ? "" : "s"}`
      : "No context files found",
  );
</script>

<ChatThreadIndent>
  {#snippet children()}
    <div
      class="overflow-hidden rounded-md border bg-secondary/50"
      data-testid="context-injection-row"
    >
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-secondary"
        aria-expanded={expanded}
        onclick={() => (toggled = !expanded)}
      >
        <RowIcon name="chevron" class="h-3 w-3 shrink-0 text-muted-foreground {expanded ? 'rotate-90' : ''}" />
        <RowIcon name="file" class="h-3 w-3 shrink-0 text-primary" />
        <span class="font-medium text-foreground">{summary}</span>
      </button>
      {#if expanded && entry.files.length > 0}
        <div class="animate-slide-in space-y-1 border-t px-3 py-2">
          {#each entry.files as file (file.path)}
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
    </div>
  {/snippet}
</ChatThreadIndent>
