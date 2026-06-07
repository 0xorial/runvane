<script lang="ts">
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
</script>

<div class="border-b border-border last:border-b-0">
  <div class="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
  <ul class="pb-1">
    {#each tasks as task (task.id)}
      <li class="group flex items-center gap-2 px-3 py-1.5 hover:bg-muted/40">
        <span class="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"></span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-xs">{task.title}</span>
          <span class="block text-[10px] text-muted-foreground">{task.kind} · {elapsed(task.startedAt)}</span>
        </span>
        <button
          type="button"
          class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
          onclick={() => onCancel(task.id)}
        >
          ×
        </button>
      </li>
    {/each}
  </ul>
</div>
