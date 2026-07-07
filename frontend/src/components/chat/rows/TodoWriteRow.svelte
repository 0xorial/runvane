<script lang="ts">
  import type { ToolInvocationEntry } from "@/protocol/chatEntry";
  import { TodoListSchema, summarizeTodos } from "../../../../../backend/src/contracts/todo";
  import { todoProgressLabel } from "@/lib/todoList";
  import ChatThreadIndent from "../ChatThreadIndent.svelte";
  import RowIcon from "../RowIcon.svelte";

  let { entry }: { entry: ToolInvocationEntry } = $props();

  const parsed = $derived(TodoListSchema.safeParse(entry.parameters?.todos));
  const summary = $derived(parsed.success ? summarizeTodos(parsed.data) : null);

  const label = $derived.by(() => {
    if (entry.state === "denied") return "To-dos update denied";
    if (entry.state === "error") return "To-dos update failed";
    if (!summary) return "Updated to-dos";
    if (summary.total === 0) return "Cleared to-dos";
    return `Updated to-dos · ${todoProgressLabel(summary)}`;
  });
</script>

<ChatThreadIndent>
  {#snippet children()}
    <div
      class="flex items-center gap-2 rounded-md border bg-secondary/40 px-3 py-1.5 text-xs"
      data-testid="todo-write-row"
      data-state={entry.state}
    >
      <RowIcon name="activity" class="h-3 w-3 shrink-0 text-primary" />
      <span class="font-medium text-foreground">{label}</span>
      {#if summary && summary.inProgress > 0}
        <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true"></span>
      {/if}
    </div>
  {/snippet}
</ChatThreadIndent>
