import { z } from 'zod';

export const ConversationEntitySchema = z.object({
  id: z.string(),
  title: z.string(),
  groupId: z.string().nullable(),
  isDeleted: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
  lastMessageAt: z.date(),
  promptTokensTotal: z.number(),
  cachedPromptTokensTotal: z.number(),
  completionTokensTotal: z.number(),
  defaultViewLeafEntryId: z.string().nullable(),
});
export type ConversationEntity = z.infer<typeof ConversationEntitySchema>;

export const CreateConversationInputSchema = z.object({
  title: z.string().optional(),
  toolSandboxId: z.string().optional(),
});
export type CreateConversationInput = z.infer<typeof CreateConversationInputSchema>;

export const ConversationGroupEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ConversationGroupEntity = z.infer<typeof ConversationGroupEntitySchema>;
