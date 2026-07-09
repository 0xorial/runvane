import { z } from 'zod';

/**
 * Per-attempt execution record for one tool-invocation entry, as served by
 * GET /api/conversations/:id/tool-invocations/:entryId/runs. `outputLog` is
 * the tool's streamed progress log (stdout, streamed tokens, …), tail-capped
 * server-side; runs that streamed nothing carry null.
 */
export const ToolRunLogRowSchema = z.object({
  id: z.string(),
  attempt: z.number().int(),
  status: z.string(),
  error: z.string().nullable(),
  outputLog: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  elapsedMs: z.number().nullable(),
});
export type ToolRunLogRow = z.infer<typeof ToolRunLogRowSchema>;

export const GetToolRunsResponseSchema = z.object({
  runs: z.array(ToolRunLogRowSchema),
});
export type GetToolRunsResponse = z.infer<typeof GetToolRunsResponseSchema>;

export function validateGetToolRunsResponse(data: unknown): GetToolRunsResponse {
  const parsed = GetToolRunsResponseSchema.safeParse(data);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `GET …/tool-invocations/:entryId/runs.${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new Error(`GET tool runs validation failed: ${details}`);
  }
  return parsed.data;
}
