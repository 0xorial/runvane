import { z } from 'zod';
import type { LlmRequest } from './types.js';

/**
 * The display/edit surface for a prepare entry IS the JSON of the LlmRequest.
 * Stringify with stable formatting so the textarea is readable; parse back
 * via JSON.parse on reprocess. What you see is exactly what gets sent.
 */
export function requestToDisplay(request: LlmRequest): string {
  return JSON.stringify(request, null, 2);
}

const LlmContentPartSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({
    kind: z.literal('image'),
    mime: z.string(),
    data: z.union([z.object({ base64: z.string() }), z.object({ url: z.string() })]),
  }),
  z.object({ kind: z.literal('file'), filename: z.string(), mime: z.string(), base64: z.string() }),
  z.object({
    kind: z.literal('attachment_ref'),
    attachmentId: z.string().min(1),
    mime: z.string().min(1),
    filename: z.string(),
    sizeBytes: z.number().finite().nonnegative(),
  }),
  z.object({ kind: z.literal('tool_call'), callId: z.string(), toolName: z.string(), args: z.unknown() }),
  z.object({ kind: z.literal('tool_result'), callId: z.string(), ok: z.boolean(), payload: z.unknown() }),
  z.object({ kind: z.literal('thinking'), text: z.string() }),
]);

const LlmMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  parts: z.array(LlmContentPartSchema),
});

const LlmRequestSchema = z.object({
  messages: z.array(LlmMessageSchema).min(1),
  tools: z
    .array(z.object({ name: z.string(), description: z.string(), paramsSchema: z.unknown() }))
    .optional(),
  toolChoice: z.enum(['auto', 'required', 'none']).optional(),
  responseFormat: z
    .union([
      z.object({ type: z.literal('json_object') }),
      z.object({ type: z.literal('json_schema'), name: z.string(), schema: z.unknown() }),
    ])
    .optional(),
  requestParams: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Parse an edited `requestText` (JSON of LlmRequest) back into a request.
 * Surfaces zod errors verbatim so the UI can show field paths.
 */
export function parseEditedRequest(text: string): LlmRequest {
  return LlmRequestSchema.parse(JSON.parse(text)) as LlmRequest;
}
