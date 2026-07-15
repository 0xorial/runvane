<script lang="ts">
  import type { AttachmentMode } from "@/api/client";
  import Icon from "@/components/ui/Icon.svelte";

  export type SelectedAttachment = { file: File; mode: AttachmentMode };

  let {
    files,
    previewUrls,
    onChangeMode,
    onRemove,
  }: {
    files: SelectedAttachment[];
    previewUrls: string[];
    onChangeMode: (index: number, mode: AttachmentMode) => void;
    onRemove: (index: number) => void;
  } = $props();
</script>

{#if files.length > 0}
  <div class="flex flex-wrap gap-2">
    {#each files as { file, mode }, idx (file.name + file.size + idx)}
      <div class="group relative flex w-[150px] flex-col gap-1.5 rounded-md border border-border bg-card p-1.5 text-card-foreground">
        <button
          type="button"
          onclick={() => onRemove(idx)}
          title="Remove file"
          class="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-background/80 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover:opacity-100"
        >
          <Icon name="x" class="h-3 w-3" />
        </button>
        {#if !previewUrls[idx]}
          <div class="flex h-[76px] w-full items-center justify-center rounded-md bg-muted text-[11px] font-bold tracking-wide text-muted-foreground">
            FILE
          </div>
        {:else if file.type === "application/pdf"}
          <iframe class="h-[76px] w-full rounded-md border-0 bg-muted" src={previewUrls[idx]} title={file.name}></iframe>
        {:else}
          <img class="h-[76px] w-full rounded-md object-cover" src={previewUrls[idx]} alt={file.name} />
        {/if}
        <div class="truncate text-xs leading-tight" title={file.name}>{file.name}</div>
        <div
          role="radiogroup"
          aria-label="Attachment mode"
          class="grid grid-cols-2 rounded-md border border-border bg-muted/60 p-[2px]"
        >
          {#each [{ value: "direct" as const, label: "Direct" }, { value: "summary" as const, label: "Summary" }] as opt (opt.value)}
            {@const active = mode === opt.value}
            <button
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={opt.label}
              title={opt.value === "direct"
                ? "Direct (raw bytes) — sent every turn"
                : "Summarize — a subagent retrieves from the full content on demand"}
              onclick={() => onChangeMode(idx, opt.value)}
              class="flex h-6 items-center justify-center gap-1 rounded-[3px] px-1 text-[11px] font-medium transition-colors {active
                ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                : 'bg-transparent text-muted-foreground hover:text-foreground'}"
            >
              {#if opt.value === "direct"}
                <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></svg>
              {:else}
                <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" /></svg>
              {/if}
              <span>{opt.label}</span>
            </button>
          {/each}
        </div>
      </div>
    {/each}
  </div>
{/if}
