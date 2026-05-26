import { z } from 'zod';

export const AskAttachmentParamsSchema = z
  .object({
    attachment_id: z
      .string()
      .min(1)
      .describe(
        'The id of an attachment present in this conversation. Use the id from an <attachment_summary> block.',
      ),
    question: z
      .string()
      .min(1)
      .describe('A single, focused natural-language question about the attachment.'),
    provider_id: z
      .string()
      .min(1)
      .optional()
      .describe('Optional LLM provider id to run the subagent against. Defaults to the global provider.'),
    model_name: z
      .string()
      .min(1)
      .optional()
      .describe('Optional model name on that provider. Defaults to the global model.'),
  })
  .strict();

export type AskAttachmentParams = z.infer<typeof AskAttachmentParamsSchema>;

export function askAttachmentParamsSchema(): unknown {
  return z.toJSONSchema(AskAttachmentParamsSchema);
}

export function parseAskAttachmentParams(raw: unknown): AskAttachmentParams {
  return AskAttachmentParamsSchema.parse(raw);
}
