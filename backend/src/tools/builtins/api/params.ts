import { z } from 'zod';

export const ApiOperationSchema = z.enum([
  'list_tools',
  'describe_tool',
  'list_agents',
  'get_agent',
  'list_model_presets',
  'get_model_preset',
  'list_tasks',
]);

export const ApiToolParamsSchema = z
  .object({
    operation: ApiOperationSchema,
    tool_name: z.string().min(1).optional().describe('Required for describe_tool.'),
    agent_id: z.string().min(1).optional().describe('Required for get_agent.'),
    preset_id: z.number().int().positive().optional().describe('Required for get_model_preset.'),
  })
  .strict();

export type ApiToolParams = z.infer<typeof ApiToolParamsSchema>;

export function apiToolParamsSchema(): unknown {
  return z.toJSONSchema(ApiToolParamsSchema);
}

export function parseApiToolParams(raw: unknown): ApiToolParams {
  return ApiToolParamsSchema.parse(raw);
}
