import { z } from 'zod';
import { AgentToolConfigSchema } from '../agents/agent.entity.js';
import { RagOverrideSchema } from './retrieval.js';

export const UserMessageOverridesSchema = z.object({
  version: z.literal(1).optional(),
  tools: z.record(z.string(), AgentToolConfigSchema).optional(),
  /** Forced retrieval for this message (see contracts/retrieval.ts). */
  rag: RagOverrideSchema.optional(),
});

export type UserMessageOverrides = z.infer<typeof UserMessageOverridesSchema>;
