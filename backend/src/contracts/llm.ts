import { z } from 'zod';

/**
 * A reference to a specific LLM: which provider, which model. The single
 * canonical shape for "an LLM" across the codebase — entries, DTOs, thought
 * context, and API requests all carry this rather than a loose
 * providerId/model pair.
 */
export const LlmRefSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
});
export type LlmRef = z.infer<typeof LlmRefSchema>;
