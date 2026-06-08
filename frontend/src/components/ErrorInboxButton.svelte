<script lang="ts">
  import { dismissAllToasts, dismissToast, subscribeToastStore, type ToastItem } from "@/utils/toast";

  let open = $state(false);
  let items = $state<ToastItem[]>([]);

  $effect(() => subscribeToastStore((next) => (items = next)));

  const errors = $derived(items.filter((x) => x.type === "error"));
  const count = $derived(errors.length);
</script>

<div class="relative">
  <button
    type="button"
    class="relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground {count > 0
      ? 'border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100'
      : ''}"
    aria-label={count > 0 ? `Errors (${count})` : "Errors"}
    title={count > 0 ? `Errors (${count})` : "Errors"}
    onclick={() => (open = !open)}
  >
    <span aria-hidden="true">⚠</span>
    {#if count > 0}
      <span class="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
        {count}
      </span>
    {/if}
  </button>
  {#if open}
    <div class="absolute right-0 top-full z-[1400] mt-1 w-80 rounded-lg border border-border bg-popover shadow-xl">
      <div class="flex items-center justify-between border-b border-border px-3 py-2">
        <strong class="text-sm">Error notifications</strong>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          disabled={count === 0}
          onclick={() => {
            dismissAllToasts();
            open = false;
          }}
        >
          Dismiss all
        </button>
      </div>
      {#if count === 0}
        <div class="px-3 py-6 text-center text-sm text-muted-foreground">No errors.</div>
      {:else}
        <div class="max-h-64 overflow-y-auto p-2">
          {#each [...errors].reverse() as t (t.id)}
            <div class="mb-1 flex gap-2 rounded-md border border-border bg-muted/40 p-2 text-sm last:mb-0">
              <div class="min-w-0 flex-1 break-words">{t.message}</div>
              <button
                type="button"
                class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                aria-label="Dismiss error"
                onclick={() => dismissToast(t.id)}
              >
                ×
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
