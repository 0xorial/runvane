<script lang="ts">
  import type { ObservableItem } from "@/utils/observableCollection";
  import type { LinkedChatEntry } from "@/lib/linkedChatEntry";
  import type { ChatEntry } from "@/protocol/chatEntry";
  import { deriveTodoList, todoProgressLabel } from "@/lib/todoList";
  import RowIcon from "./RowIcon.svelte";

  let { entries }: { entries: ObservableItem<LinkedChatEntry>[] } = $props();

  let collapsed = $state(false);

  const list = $derived.by(() => {
    const rows = entries.map((row$) => row$.get() as ChatEntry);
    return deriveTodoList(rows);
  });
</script>

{#if list}
  <div class="border-t border-border bg-secondary/40 px-3 py-2" data-testid="todo-list-panel">
    <button
      type="button"
      class="flex w-full items-center gap-2 text-left text-xs"
      aria-expanded={!collapsed}
      onclick={() => (collapsed = !collapsed)}
    >
      <RowIcon
        name="chevron"
        class="h-3 w-3 shrink-0 text-muted-foreground {collapsed ? '' : 'rotate-90'}"
      />
      <span class="font-medium text-foreground">To-dos</span>
      <span class="text-muted-foreground">{todoProgressLabel(list.summary)}</span>
      {#if list.summary.inProgress > 0}
        <span class="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-500" aria-hidden="true"></span>
      {/if}
    </button>

    {#if !collapsed}
      <ul class="animate-slide-in mt-2 space-y-1" data-testid="todo-list-items">
        {#each list.todos as todo, i (i)}
          {@const active = todo.status === "in_progress"}
          <li class="flex items-start gap-2 text-xs" data-status={todo.status}>
            {#if todo.status === "completed"}
              <svg
                class="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-500"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            {:else if active}
              <span
                class="mt-1 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-amber-500"
                aria-hidden="true"
              ></span>
            {:else}
              <span
                class="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-muted-foreground/50"
                aria-hidden="true"
              ></span>
            {/if}
            <span
              class={todo.status === "completed"
                ? "text-muted-foreground line-through"
                : active
                  ? "font-medium text-foreground"
                  : "text-secondary-foreground"}
            >
              {active && todo.activeForm ? todo.activeForm : todo.content}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}
