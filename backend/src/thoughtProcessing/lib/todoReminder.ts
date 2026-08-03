import type { ChatEntry } from '../../contracts/chatEntry.js';
import { TodoListSchema, type TodoItem } from '../../contracts/todo.js';

export const TODO_WRITE_TOOL_ID = 'todo_write';

/**
 * How many message-producing entries (user/assistant/tool turns) may follow the
 * last `todo_write` before the list is re-surfaced as a tail reminder. Below
 * this the list is still fresh in the model's context (the tool call itself is
 * replayed there); at or past it the plan has scrolled far enough back that
 * models drift off it.
 */
export const TODO_REMINDER_AFTER_ENTRIES = 6;

/** Entry types that become prompt messages — the distance unit for staleness. */
function isPromptEntry(entry: ChatEntry): boolean {
  return entry.type === 'user-message' || entry.type === 'assistant-message' || entry.type === 'tool-invocation';
}

/**
 * The branch's current to-do list = the `todos` params of the most recent
 * usable `todo_write` invocation on the lineage (mirrors the frontend's
 * deriveTodoList). Denied/errored calls never took effect and are skipped; an
 * empty accepted list means the model cleared it. Also reports how many
 * message-producing entries follow that call — the staleness distance.
 */
export function deriveCurrentTodos(entries: readonly ChatEntry[]): { todos: TodoItem[]; entriesSince: number } | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.type !== 'tool-invocation' || entry.toolId !== TODO_WRITE_TOOL_ID) continue;
    if (entry.state === 'denied' || entry.state === 'error') continue;
    const parsed = TodoListSchema.safeParse(entry.parameters?.todos);
    if (!parsed.success) continue;
    if (parsed.data.length === 0) return null;
    let entriesSince = 0;
    for (let j = i + 1; j < entries.length; j++) {
      if (isPromptEntry(entries[j]!)) entriesSince++;
    }
    return { todos: parsed.data, entriesSince };
  }
  return null;
}

/**
 * The tail system note re-surfacing a stale to-do list, or null when no
 * reminder is due: no list, list still fresh, or everything already completed.
 * The caller gates on `todo_write` being available this turn — reminding the
 * model to call a tool it doesn't have would misfire.
 */
export function buildTodoReminder(entries: readonly ChatEntry[]): string | null {
  const derived = deriveCurrentTodos(entries);
  if (!derived) return null;
  if (derived.entriesSince < TODO_REMINDER_AFTER_ENTRIES) return null;
  if (derived.todos.every((t) => t.status === 'completed')) return null;
  const lines = derived.todos.map((t) => `- [${t.status}] ${t.content}`);
  return (
    `[Reminder — your current to-do list, last updated ${derived.entriesSince} entries ago]\n` +
    `${lines.join('\n')}\n` +
    'Keep working through it. When statuses change, rewrite the whole list via todo_write; ' +
    'if the plan itself changed, update the items to match.'
  );
}
