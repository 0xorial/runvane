import { z } from 'zod';
import { AgentToolConfigSchema } from '../agents/agent.entity.js';

export const UserMessageOverridesSchema = z.object({
  version: z.literal(1).optional(),
  tools: z.record(z.string(), AgentToolConfigSchema).optional(),
});

export type UserMessageOverrides = z.infer<typeof UserMessageOverridesSchema>;
