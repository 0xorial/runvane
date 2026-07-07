import { z } from 'zod';

export const TodoWriteToolRulesSchema = z.object({}).strict();

export type TodoWriteToolRules = z.infer<typeof TodoWriteToolRulesSchema>;

export function parseTodoWriteToolRules(raw: unknown): TodoWriteToolRules {
  return TodoWriteToolRulesSchema.parse(raw);
}
