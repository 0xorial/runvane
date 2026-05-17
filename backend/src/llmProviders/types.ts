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

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export type LlmContentPart =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mime: string; data: { base64: string } | { url: string } }
  | { kind: 'file'; filename: string; mime: string; base64: string }
  | {
      /**
       * Lightweight reference to a stored upload. Carries metadata only —
       * never raw bytes — so it stays small in `requestText`, on the SSE
       * wire, and in the prepare-entry editor. The reason step expands
       * each ref to the corresponding `image`/`file` part right before
       * calling the provider adapter; adapters never see this kind.
       */
      kind: 'attachment_ref';
      attachmentId: string;
      mime: string;
      filename: string;
      sizeBytes: number;
    }
  | { kind: 'tool_call'; callId: string; toolName: string; args: unknown }
  | { kind: 'tool_result'; callId: string; ok: boolean; payload: unknown }
  | { kind: 'thinking'; text: string };

export type LlmMessage = {
  role: LlmRole;
  parts: LlmContentPart[];
};

export type LlmToolSpec = {
  name: string;
  description: string;
  paramsSchema: unknown;
};

export type LlmResponseFormat =
  | { type: 'json_object' }
  | { type: 'json_schema'; name: string; schema: unknown };

/**
 * Provider-agnostic request payload. `model` is intentionally NOT part of
 * this type — model selection is resolved separately (LlmRef / provider
 * settings) and stamped onto the wire body by the provider adapter.
 */
export type LlmRequest = {
  messages: LlmMessage[];
  tools?: LlmToolSpec[];
  toolChoice?: 'auto' | 'required' | 'none';
  responseFormat?: LlmResponseFormat;
  requestParams?: Record<string, unknown>;
};

export type LlmFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';

export type LlmUsage = {
  promptTokens: number;
  completionTokens: number;
  cachedPromptTokens?: number;
  reasoningTokens?: number;
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
