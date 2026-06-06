import { z } from 'zod';

export const MetaOperationSchema = z.enum(['list_tools', 'describe_tool', 'conversation_summary']);

export const MetaToolParamsSchema = z
  .object({
    operation: MetaOperationSchema,
    tool_name: z.string().min(1).optional().describe('Required for describe_tool.'),
  })
  .strict();

export type MetaToolParams = z.infer<typeof MetaToolParamsSchema>;

export function metaToolParamsSchema(): unknown {
  return z.toJSONSchema(MetaToolParamsSchema);
}

export function parseMetaToolParams(raw: unknown): MetaToolParams {
  return MetaToolParamsSchema.parse(raw);
}
