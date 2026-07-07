import { z } from 'zod';

/**
 * The evolving to-do list an agent maintains to stay focused on a multi-step
 * goal — the runvane equivalent of Claude Code's TodoWrite. The whole list is
 * rewritten on every `todo_write` call (never patched incrementally), so the
 * latest call's `todos` array is the current state. The list is not stored in
 * its own table: each call is an ordinary `tool-invocation` chat entry, so the
 * current list is simply `parameters.todos` of the most recent `todo_write`
 * entry on the active branch — persistence, branching, and reprocess come for
 * free from the entry DAG.
 */
export const TodoStatusSchema = z.enum(['pending', 'in_progress', 'completed']);
export type TodoStatus = z.infer<typeof TodoStatusSchema>;

export const TodoItemSchema = z
  .object({
    /** Imperative description of the step, e.g. "Add the migration". */
    content: z.string().min(1).describe('Imperative description of the step, e.g. "Add the migration".'),
    status: TodoStatusSchema.describe('One of pending | in_progress | completed. Keep exactly one in_progress.'),
    /**
     * Present-continuous phrasing shown while the step runs, e.g. "Adding the
     * migration". Optional — falls back to `content` when omitted.
     */
    activeForm: z
      .string()
      .min(1)
      .optional()
      .describe('Present-continuous form shown while active, e.g. "Adding the migration". Optional.'),
  })
  .strict();
export type TodoItem = z.infer<typeof TodoItemSchema>;

export const TodoListSchema = z.array(TodoItemSchema);
export type TodoList = z.infer<typeof TodoListSchema>;

export type TodoSummary = {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
};

export function summarizeTodos(todos: readonly TodoItem[]): TodoSummary {
  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  for (const t of todos) {
    if (t.status === 'completed') completed++;
    else if (t.status === 'in_progress') inProgress++;
    else pending++;
  }
  return { total: todos.length, completed, inProgress, pending };
}
