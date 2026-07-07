import { z } from 'zod';
import { TodoItemSchema } from '../../../contracts/todo.js';

export const TodoWriteToolParamsSchema = z
  .object({
    todos: z
      .array(TodoItemSchema)
      .describe(
        'The COMPLETE to-do list after this update — it replaces the previous list wholesale, so always send every item, not just the changed ones. Keep exactly one item in_progress at a time.',
      ),
  })
  .strict();

export type TodoWriteToolParams = z.infer<typeof TodoWriteToolParamsSchema>;

/** JSON Schema for the LLM, derived from the Zod schema — single source of truth. */
export function todoWriteParamsSchema(): unknown {
  return z.toJSONSchema(TodoWriteToolParamsSchema);
}

export function parseTodoWriteToolParams(raw: unknown): TodoWriteToolParams {
  return TodoWriteToolParamsSchema.parse(raw);
}
