import { z } from 'zod';

export const TaskKindSchema = z.enum(['llm', 'tool']);
export type TaskKind = z.infer<typeof TaskKindSchema>;

export const TaskStatusSchema = z.enum(['running', 'cancelling']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskInfoSchema = z.object({
  id: z.string(),
  kind: TaskKindSchema,
  title: z.string(),
  conversationId: z.string().nullable(),
  status: TaskStatusSchema,
  startedAt: z.string(),
});
export type TaskInfo = z.infer<typeof TaskInfoSchema>;

export const TaskSseType = {
  SNAPSHOT: 'task_snapshot',
  UPSERT: 'task_upsert',
  REMOVED: 'task_removed',
} as const;
export type TaskSseEventType = (typeof TaskSseType)[keyof typeof TaskSseType];

export const TaskSnapshotEventSchema = z.object({
  type: z.literal(TaskSseType.SNAPSHOT),
  tasks: z.array(TaskInfoSchema),
});
export const TaskUpsertEventSchema = z.object({
  type: z.literal(TaskSseType.UPSERT),
  task: TaskInfoSchema,
});
export const TaskRemovedEventSchema = z.object({
  type: z.literal(TaskSseType.REMOVED),
  id: z.string(),
});

export const TaskSseEventSchema = z.discriminatedUnion('type', [
  TaskSnapshotEventSchema,
  TaskUpsertEventSchema,
  TaskRemovedEventSchema,
]);
export type TaskSseEvent = z.infer<typeof TaskSseEventSchema>;
