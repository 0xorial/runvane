<script lang="ts">
  import Icon from "@/components/ui/Icon.svelte";
  import type { TaskInfo } from "../../../../../backend/src/contracts/task";

  let {
    label,
    tasks,
    elapsed,
    onCancel,
  }: {
    label: string;
    tasks: TaskInfo[];
    elapsed: (startedAt: string) => string;
    onCancel: (id: string) => void;
  } = $props();

  function dotClass(task: TaskInfo): string {
    if (task.status === "cancelling") return "bg-amber-500";
    if (task.kind === "tool") return "bg-sky-500";
    if (task.kind === "ingest") return "bg-violet-500";
    return "bg-emerald-500";
  }
</script>

<div class="border-b border-border last:border-b-0">
  <div class="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
  <ul class="pb-1">
    {#each tasks as task (task.id)}
      {@const cancelling = task.status === "cancelling"}
      <li class="group flex items-center gap-2 px-3 py-1.5 hover:bg-muted/40">
        <span class="inline-flex h-1.5 w-1.5 shrink-0 rounded-full {dotClass(task)}"></span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-xs text-foreground">{task.title}</span>
          <span class="block text-[10px] text-muted-foreground">
            {task.kind} · {elapsed(task.startedAt)}
            {#if task.progress}
              <span> · </span><span class="tabular-nums">{task.progress}</span>
            {/if}
            {#if cancelling}
              <span> · </span><span class="text-amber-600 dark:text-amber-400">cancelling…</span>
            {/if}
          </span>
        </span>
        <button
          type="button"
          disabled={cancelling}
          title="Cancel task"
          aria-label="Cancel task"
          class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
          onclick={() => onCancel(task.id)}
        >
          <Icon name="x" class="h-3.5 w-3.5" strokeWidth={2.25} />
        </button>
      </li>
    {/each}
  </ul>
</div>
