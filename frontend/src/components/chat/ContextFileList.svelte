<script lang="ts">
  import type { PreinjectPreviewFile } from "@/api/contextInjectionClient";

  // Shared candidate-file list: read-only rows in the Start context section,
  // checkbox rows in the composer's per-message attach picker. Every injectable
  // row expands to the exact planner section it would contribute.
  let {
    files,
    selectable = false,
    selectedPaths = [],
    onToggle,
  }: {
    files: PreinjectPreviewFile[];
    /** Adds a checkbox per injectable row (per-message attach picker). */
    selectable?: boolean;
    selectedPaths?: string[];
    onToggle?: (path: string) => void;
  } = $props();

  let expandedFile = $state<string | null>(null);

  function toggleExpand(path: string): void {
    expandedFile = expandedFile === path ? null : path;
  }
</script>

<div class="space-y-px">
  {#each files as file (file.path)}
    {@const injected = file.status === "injected"}
    <div>
      <div class="flex items-center gap-1.5">
        {#if selectable && injected}
          <input
            type="checkbox"
            data-testid="context-file-check"
            data-file-path={file.path}
            checked={selectedPaths.includes(file.path)}
            onchange={() => onToggle?.(file.path)}
            class="h-3 w-3 shrink-0 cursor-pointer accent-[hsl(var(--primary))]"
          />
        {/if}
        <button
          type="button"
          data-testid="context-file-row"
          data-file-path={file.path}
          disabled={!injected}
          aria-expanded={expandedFile === file.path}
          onclick={() => toggleExpand(file.path)}
          class="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] {injected
            ? 'hover:bg-secondary/45'
            : 'cursor-default opacity-60'}"
        >
          <svg
            class="h-2.5 w-2.5 shrink-0 text-muted-foreground transition-transform {expandedFile === file.path
              ? 'rotate-90'
              : ''} {injected ? '' : 'invisible'}"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          <code class="text-secondary-foreground">{file.path}</code>
          {#if injected}
            <span class="ml-auto shrink-0 tabular-nums text-muted-foreground">~{file.tokens ?? 0} tok</span>
          {:else}
            <span
              class="ml-auto shrink-0 rounded bg-muted px-1 py-px text-[10px] uppercase tracking-wide text-muted-foreground"
            >
              skipped
            </span>
          {/if}
        </button>
      </div>
      {#if expandedFile === file.path && file.content}
        <pre
          data-testid="context-file-content"
          class="scrollbar-thin mx-1 mb-1 max-h-36 overflow-y-auto whitespace-pre-wrap break-words rounded bg-secondary/40 px-2 py-1 text-[11px] text-muted-foreground">{file.content}</pre>
      {/if}
    </div>
  {/each}
</div>
