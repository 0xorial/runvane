import { z } from 'zod';

export const PendingWorkKindSchema = z.enum(['spawn', 'run', 'delay', 'timer']);
export type PendingWorkKind = z.infer<typeof PendingWorkKindSchema>;

export const PendingWorkItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: PendingWorkKindSchema,
  startedAt: z.string(),
});
export type PendingWorkItem = z.infer<typeof PendingWorkItemSchema>;

export const RegisteredWorkScopeSchema = z.object({
  id: z.string(),
  label: z.string(),
  conversationId: z.string().nullable(),
  registeredAt: z.string(),
  pending: z.number(),
  items: z.array(PendingWorkItemSchema),
});
export type RegisteredWorkScope = z.infer<typeof RegisteredWorkScopeSchema>;

export const AsyncEntryKindSchema = z.enum([
  'timer',
  'interval',
  'immediate',
  'next_tick',
  'microtask',
  'async_hook',
]);
export type AsyncEntryKind = z.infer<typeof AsyncEntryKindSchema>;

export const AsyncTaskEntrySchema = z.object({
  id: z.string(),
  kind: AsyncEntryKindSchema,
  label: z.string(),
  contextPath: z.string().nullable(),
  conversationId: z.string().nullable(),
  scheduledAt: z.string(),
  hookType: z.string().nullable(),
  detail: z.string().nullable(),
  attributed: z.boolean(),
  suspicious: z.boolean(),
  originClass: z.enum(['none', 'app', 'framework', 'unknown']),
  originSite: z.string().nullable(),
  originStack: z.array(z.string()),
  hookAsyncId: z.number().nullable(),
  triggerAsyncId: z.number().nullable(),
  stale: z.boolean(),
  observingSelf: z.boolean(),
  state: z.enum(['scheduled', 'running']),
});
export type AsyncTaskEntry = z.infer<typeof AsyncTaskEntrySchema>;

export const AsyncWorkSummarySchema = z.object({
  attributed: z.number(),
  suspicious: z.number(),
  unattributed_infra: z.number(),
});
export type AsyncWorkSummary = z.infer<typeof AsyncWorkSummarySchema>;

export const GetWorkMonitorResponseSchema = z.object({
  pending_work: z.number(),
  pending_scopes: z.number(),
  pending_async: z.number(),
  async_summary: AsyncWorkSummarySchema,
  scopes: z.array(RegisteredWorkScopeSchema),
  async_entries: z.array(AsyncTaskEntrySchema),
});
export type GetWorkMonitorResponse = z.infer<typeof GetWorkMonitorResponseSchema>;

export function validateGetWorkMonitorResponse(data: unknown): GetWorkMonitorResponse {
  return GetWorkMonitorResponseSchema.parse(data);
}
