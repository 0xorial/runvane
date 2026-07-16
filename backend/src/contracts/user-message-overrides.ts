import { z } from 'zod';
import { AgentToolConfigSchema } from '../agents/agent.entity.js';
import { ContextFilesOverrideSchema } from './preinject.js';
import { KnowledgeOverrideSchema } from './retrieval.js';

export const UserMessageOverridesSchema = z.object({
  version: z.literal(1).optional(),
  tools: z.record(z.string(), AgentToolConfigSchema).optional(),
  /** Forced retrieval for this message (see contracts/retrieval.ts). */
  knowledge: KnowledgeOverrideSchema.optional(),
  /** Explicit context-files attach for this message (see contracts/preinject.ts). */
  contextFiles: ContextFilesOverrideSchema.optional(),
});

export type UserMessageOverrides = z.infer<typeof UserMessageOverridesSchema>;
