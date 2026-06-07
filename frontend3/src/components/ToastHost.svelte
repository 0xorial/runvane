<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "@/components/ui/Icon.svelte";
  import { dismissToast, subscribeToastStore, type ToastItem } from "@/utils/toast";

  let items = $state<ToastItem[]>([]);
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  function scheduleDismiss(item: ToastItem): void {
    if (timers.has(item.id)) return;
    timers.set(
      item.id,
      setTimeout(() => {
        dismissToast(item.id);
        timers.delete(item.id);
      }, item.durationMs),
    );
  }

  onMount(() => {
    return subscribeToastStore((next) => {
      const visible = next.filter((x) => !x.hidden);
      for (const item of visible) scheduleDismiss(item);
      items = visible;
    });
  });
</script>

<div class="pointer-events-none fixed bottom-3 right-3 z-[2000] flex max-w-sm flex-col gap-2">
  {#each items as item (item.id)}
    <div
      class="pointer-events-auto rounded-lg border px-3 py-2 text-xs shadow-lg {item.type === 'error'
        ? 'border-destructive/40 bg-destructive/10 text-destructive'
        : 'border-border bg-card text-foreground'}"
    >
      <div class="flex items-start justify-between gap-2">
        <span>{item.message}</span>
        <button type="button" class="shrink-0 opacity-70" onclick={() => dismissToast(item.id)} aria-label="Dismiss">
          <Icon name="x" class="h-4 w-4" />
        </button>
      </div>
    </div>
  {/each}
</div>
