import type { ChatEntry, ToolInvocationEntry } from "@/protocol/chatEntry";
import { TodoListSchema, summarizeTodos, type TodoItem, type TodoSummary } from "../../../backend/src/contracts/todo";

export const TODO_WRITE_TOOL_ID = "todo_write";

export type DerivedTodoList = {
  todos: TodoItem[];
  summary: TodoSummary;
};

function isTodoWriteEntry(entry: ChatEntry): entry is ToolInvocationEntry {
  return entry.type === "tool-invocation" && entry.toolId === TODO_WRITE_TOOL_ID;
}

/**
 * The current to-do list for a branch = the `todos` params of the most recent
 * `todo_write` tool call along the active path. `todo_write` rewrites the whole
 * list each call, so only the last one matters. Denied/errored calls never took
 * effect, so they're skipped and the prior list stands. Returns null when the
 * branch has no usable to-do list (nothing to show).
 */
export function deriveTodoList(entries: readonly ChatEntry[]): DerivedTodoList | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!isTodoWriteEntry(entry)) continue;
    if (entry.state === "denied" || entry.state === "error") continue;
    const parsed = TodoListSchema.safeParse(entry.parameters?.todos);
    if (!parsed.success) continue;
    if (parsed.data.length === 0) return null;
    return { todos: parsed.data, summary: summarizeTodos(parsed.data) };
  }
  return null;
}

/** Compact "2/5 done" style label used by the transcript row and panel header. */
export function todoProgressLabel(summary: TodoSummary): string {
  return `${summary.completed}/${summary.total} done`;
}
