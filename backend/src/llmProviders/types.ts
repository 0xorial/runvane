/**
 * Provider-agnostic LLM I/O model.
 *
 * Input shape: `LlmRequest` carries multipart messages + optional tools/format.
 * Output shape: `LlmCompletion` is a structured list of parts (text/thinking/
 * tool_call). Streaming is exposed as `LlmStreamEvent` deltas.
 *
 * Provider adapters translate this canonical model to/from each wire format
 * (OpenAI Chat Completions, Anthropic Messages, Gemini, raw text endpoints,
 * etc.). Domain code never deals with provider-specific shapes.
 */

import { z } from 'zod';

export const LlmRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export type LlmRole = z.infer<typeof LlmRoleSchema>;

export const LlmContentPartSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({
    kind: z.literal('image'),
    mime: z.string(),
    data: z.union([z.object({ base64: z.string() }), z.object({ url: z.string() })]),
  }),
  z.object({ kind: z.literal('file'), filename: z.string(), mime: z.string(), base64: z.string() }),
  z.object({
    /**
     * Lightweight reference to a stored upload. Carries metadata only —
     * never raw bytes — so it stays small in `requestText`, on the SSE
     * wire, and in the prepare-entry editor. The reason step expands
     * each ref to the corresponding `image`/`file` part right before
     * calling the provider adapter; adapters never see this kind.
     */
    kind: z.literal('attachment_ref'),
    attachmentId: z.string(),
    mime: z.string(),
    filename: z.string(),
    sizeBytes: z.number(),
  }),
  z.object({ kind: z.literal('tool_call'), callId: z.string(), toolName: z.string(), args: z.unknown() }),
  z.object({ kind: z.literal('tool_result'), callId: z.string(), ok: z.boolean(), payload: z.unknown() }),
  z.object({ kind: z.literal('thinking'), text: z.string() }),
]);
export type LlmContentPart = z.infer<typeof LlmContentPartSchema>;

export const LlmMessageSchema = z.object({
  role: LlmRoleSchema,
  parts: z.array(LlmContentPartSchema),
});
export type LlmMessage = z.infer<typeof LlmMessageSchema>;

export const LlmToolSpecSchema = z.object({
  name: z.string(),
  description: z.string(),
  paramsSchema: z.unknown(),
});
export type LlmToolSpec = z.infer<typeof LlmToolSpecSchema>;

export const LlmResponseFormatSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('json_object') }),
  z.object({ type: z.literal('json_schema'), name: z.string(), schema: z.unknown() }),
]);
export type LlmResponseFormat = z.infer<typeof LlmResponseFormatSchema>;

/**
 * Provider-agnostic request payload. `model` is intentionally NOT part of
 * this type — model selection is resolved separately (LlmRef / provider
 * settings) and stamped onto the wire body by the provider adapter.
 */
export const LlmRequestSchema = z.object({
  messages: z.array(LlmMessageSchema),
  tools: z.array(LlmToolSpecSchema).optional(),
  toolChoice: z.enum(['auto', 'required', 'none']).optional(),
  responseFormat: LlmResponseFormatSchema.optional(),
  requestParams: z.record(z.string(), z.unknown()).optional(),
});
export type LlmRequest = z.infer<typeof LlmRequestSchema>;

export type LlmFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';

export type LlmUsage = {
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens?: number;
  reasoningTokens?: number;
  /** Provider-reported USD cost (e.g. OpenRouter `usage.cost` / generation API). */
  costUsd?: number;
};

export type LlmOutputPart =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_call'; callId: string; toolName: string; args: unknown };

/**
 * Streaming events. Adapters emit these as the model produces output;
 * the provider promise resolves to the fully-accumulated `LlmCompletion`.
 *
 * `tool_call_delta` carries argument JSON as raw string fragments; the
 * adapter accumulates and JSON-parses at completion time.
 */
export type LlmStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_call_delta'; index: number; callId?: string; toolName?: string; argsDelta?: string }
  | { type: 'usage'; usage: LlmUsage }
  | { type: 'finish'; reason: LlmFinishReason };

export type LlmCompletion = {
  parts: LlmOutputPart[];
  finishReason: LlmFinishReason;
  usage?: LlmUsage;
  /**
   * Raw provider chunks exactly as received — the parsed JSON of each streaming
   * `data: {…}` payload (or the single body for non-streaming). Present only for
   * adapters that capture it (OpenAI-compatible); used for the raw-response view.
   */
  rawChunks?: unknown[];
};

/** Convenience: build a single-text-part message. */
export function textMessage(role: LlmRole, text: string): LlmMessage {
  return { role, parts: [{ kind: 'text', text }] };
}

/** Concat all `text` parts of a message (ignores other kinds). */
export function getMessageText(message: LlmMessage): string {
  return message.parts
    .filter((p): p is Extract<LlmContentPart, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('\n');
}

/** Concat all `text` parts of a completion (final user-facing answer). */
export function getCompletionText(completion: LlmCompletion): string {
  return completion.parts
    .filter((p): p is Extract<LlmOutputPart, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('');
}

/** Concat all `thinking` parts of a completion (reasoning content). */
export function getCompletionThinking(completion: LlmCompletion): string {
  return completion.parts
    .filter((p): p is Extract<LlmOutputPart, { kind: 'thinking' }> => p.kind === 'thinking')
    .map((p) => p.text)
    .join('');
}

/** Tool-calls produced by the completion (in order). */
export function getCompletionToolCalls(
  completion: LlmCompletion,
): Array<Extract<LlmOutputPart, { kind: 'tool_call' }>> {
  return completion.parts.filter(
    (p): p is Extract<LlmOutputPart, { kind: 'tool_call' }> => p.kind === 'tool_call',
  );
}
