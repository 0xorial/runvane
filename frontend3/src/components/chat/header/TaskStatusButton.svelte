<script lang="ts">
  import { cancelTask } from "@/api/client";
  import { getTasksSnapshot, ensureTasksStream } from "@/lib/tasksStore.svelte";
  import { notifyError } from "@/utils/toast";
  import { onMount } from "svelte";
  import Icon from "@/components/ui/Icon.svelte";
  import TaskGroup from "./TaskGroup.svelte";

  let { conversationId }: { conversationId: string | null } = $props();

  let open = $state(false);
  let tick = $state(0);

  onMount(() => {
    ensureTasksStream();
    const id = setInterval(() => {
      tick += 1;
    }, 1000);
    return () => clearInterval(id);
  });

  const tasks = $derived.by(() => {
    void tick;
    return getTasksSnapshot();
  });

  const local = $derived(
    conversationId ? tasks.filter((t) => t.conversationId === conversationId) : [],
  );
  const others = $derived(
    conversationId ? tasks.filter((t) => t.conversationId !== conversationId) : tasks,
  );
  const total = $derived(tasks.length);
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

<div class="relative">
  <button
    type="button"
    class="inline-flex h-7 min-w-[28px] items-center justify-center gap-1 rounded-md px-1.5 text-xs {active
      ? 'bg-primary/15 text-primary hover:bg-primary/25'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
    aria-label={active ? `${total} tasks running` : "No tasks running"}
    onclick={() => (open = !open)}
  >
    {#if active}
      <Icon name="loader" class="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
    {:else}
      <Icon name="activity" class="h-3.5 w-3.5" />
    {/if}
    {#if active}<span class="tabular-nums">{total}</span>{/if}
  </button>
  {#if open}
    <div class="absolute right-0 top-full z-[1400] mt-1 w-80 rounded-lg border border-border bg-popover shadow-xl">
      <div class="flex items-center justify-between border-b border-border px-3 py-2">
        <span class="text-xs font-medium">Tasks ({total})</span>
        {#if local.length > 0 && conversationId}
          <button
            type="button"
            class="text-[11px] text-muted-foreground hover:text-foreground"
            onclick={() => {
              for (const t of local) safeCancel(t.id);
            }}
          >
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
