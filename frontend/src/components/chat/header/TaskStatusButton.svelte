<script lang="ts">
  import { cancelTask } from "@/api/client";
  import { getTasksSnapshot, ensureTasksStream } from "@/lib/tasksStore.svelte";
  import { notifyError } from "@/utils/toast";
  import { onMount } from "svelte";
  import { popupPosition } from "@/lib/popupPosition";
  import { portal } from "@/lib/portal";
  import Icon from "@/components/ui/Icon.svelte";
  import TaskGroup from "./TaskGroup.svelte";

  let { conversationId }: { conversationId: string | null } = $props();

  let open = $state(false);
  let tick = $state(0);
  let root = $state<HTMLDivElement | null>(null);
  let panel = $state<HTMLDivElement | null>(null);

  onMount(() => {
    ensureTasksStream();
    const id = setInterval(() => {
      tick += 1;
    }, 1000);
    return () => clearInterval(id);
  });

  $effect(() => {
    if (!open) return;
    function onDocMouseDown(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (root?.contains(target) || panel?.contains(target)) return;
      open = false;
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  });

  const tasks = $derived.by(() => {
    void tick;
    return getTasksSnapshot();
  });

  const local = $derived(conversationId ? tasks.filter((t) => t.conversationId === conversationId) : []);
  const others = $derived(conversationId ? tasks.filter((t) => t.conversationId !== conversationId) : tasks);
  const total = $derived(tasks.length);
  const localCount = $derived(local.length);
  const active = $derived(total > 0);

  function elapsed(startedAt: string): string {
    const startMs = Date.parse(startedAt);
    const sec = Math.max(0, Math.round((Date.now() - (Number.isFinite(startMs) ? startMs : Date.now())) / 1000));
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    return `${m}m${(sec % 60).toString().padStart(2, "0")}s`;
  }

  function safeCancel(id: string): void {
    void cancelTask(id).catch((e) => {
      notifyError(`Failed to cancel task: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
</script>

<div class="relative" bind:this={root}>
  <button
    type="button"
    class="relative inline-flex h-7 min-w-[28px] shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-xs transition-colors {active
      ? 'bg-primary/15 text-primary hover:bg-primary/25'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
    aria-label={active ? `${total} task${total === 1 ? '' : 's'} running` : "No tasks running"}
    title={active ? `${total} running` : "No tasks"}
    onclick={() => (open = !open)}
  >
    {#if active}
      <Icon name="loader" class="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
    {:else}
      <Icon name="activity" class="h-3.5 w-3.5" strokeWidth={2} />
    {/if}
    {#if active}<span class="tabular-nums">{total}</span>{/if}
  </button>
  {#if open}
    <div
      use:portal
      use:popupPosition={{ anchor: root, align: "end", gap: 6 }}
      bind:this={panel}
      class="fixed z-[1500] flex w-80 flex-col overflow-hidden rounded-lg border border-border bg-popover p-0 shadow-xl"
    >
      <div class="flex items-center justify-between border-b border-border px-3 py-2">
        <span class="text-xs font-medium text-foreground">
          Tasks <span class="ml-1 text-muted-foreground">({total})</span>
        </span>
        {#if localCount > 0 && conversationId}
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Cancel all tasks on this conversation"
            onclick={() => {
              for (const t of local) safeCancel(t.id);
            }}
          >
            <Icon name="square" class="h-3 w-3" />
            Cancel this conversation
          </button>
        {/if}
      </div>
      {#if total === 0}
        <div class="px-3 py-4 text-xs text-muted-foreground">No tasks in flight.</div>
      {:else}
        <div class="max-h-[60vh] overflow-y-auto">
          {#if conversationId && local.length > 0}
            <TaskGroup label="This conversation" tasks={local} {elapsed} onCancel={safeCancel} />
          {/if}
          {#if others.length > 0}
            <TaskGroup
              label={conversationId ? "Other conversations" : "All tasks"}
              tasks={others}
              {elapsed}
              onCancel={safeCancel}
            />
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
