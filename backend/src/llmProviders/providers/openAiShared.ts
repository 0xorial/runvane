import type {
  LlmCompletion,
  LlmContentPart,
  LlmFinishReason,
  LlmMessage,
  LlmOutputPart,
  LlmRequest,
  LlmResponseFormat,
  LlmStreamEvent,
  LlmToolSpec,
  LlmUsage,
} from '../types.js';

/**
 * Helpers shared between OpenAI Chat-Completions-compatible adapters
 * (openAiCompatible.ts, openRouter.ts).
 *
 * Encodes the canonical translation:
 *   LlmRequest  -> OpenAI request body
 *   SSE stream  -> LlmStreamEvent[] + accumulated LlmCompletion
 *
 * Usage details (token counting variants per provider) live in the caller;
 * this module provides only the structural translation.
 */

type OpenAiMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<Record<string, unknown>> | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
};

/** Convert canonical messages to OpenAI Chat Completions `messages` array. */
export function toOpenAiMessages(messages: LlmMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      // OpenAI requires one message per tool result.
      for (const part of m.parts) {
        if (part.kind !== 'tool_result') continue;
        out.push({ role: 'tool', tool_call_id: part.callId, content: stringifyPayload(part.payload) });
      }
      continue;
    }
    if (m.role === 'assistant') {
      const text = collectText(m.parts);
      const toolCalls = m.parts
        .filter((p): p is Extract<LlmContentPart, { kind: 'tool_call' }> => p.kind === 'tool_call')
        .map((p) => ({
          id: p.callId,
          type: 'function' as const,
          function: { name: p.toolName, arguments: stringifyArgs(p.args) },
        }));
      const msg: OpenAiMessage = { role: 'assistant', content: text || null };
      if (toolCalls.length > 0) msg.tool_calls = toolCalls;
      out.push(msg);
      continue;
    }
    // system + user: text-only fast path; widen to multipart if media present.
    const hasMedia = m.parts.some((p) => p.kind === 'image' || p.kind === 'file');
    if (!hasMedia) {
      out.push({ role: m.role, content: collectText(m.parts) });
      continue;
    }
    const content: Array<Record<string, unknown>> = [];
    for (const part of m.parts) {
      if (part.kind === 'text') {
        content.push({ type: 'text', text: part.text });
      } else if (part.kind === 'image') {
        const url =
          'url' in part.data ? part.data.url : `data:${part.mime};base64,${part.data.base64}`;
        content.push({ type: 'image_url', image_url: { url } });
      } else if (part.kind === 'file') {
        content.push({
          type: 'file',
          file: { filename: part.filename, file_data: `data:${part.mime};base64,${part.base64}` },
        });
      }
    }
    out.push({ role: m.role, content });
  }
  return out;
}

function collectText(parts: LlmContentPart[]): string {
  return parts
    .filter((p): p is Extract<LlmContentPart, { kind: 'text' }> => p.kind === 'text')
    .map((p) => p.text)
    .join('');
}

function stringifyPayload(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function stringifyArgs(args: unknown): string {
  if (typeof args === 'string') return args;
  return JSON.stringify(args ?? {});
}

/** Convert canonical tool spec to OpenAI `tools` array. */
export function toOpenAiTools(tools: LlmToolSpec[] | undefined):
  | Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>
  | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.paramsSchema },
  }));
}

export function toOpenAiResponseFormat(rf: LlmResponseFormat | undefined): unknown {
  if (!rf) return undefined;
  if (rf.type === 'json_object') return { type: 'json_object' };
  return { type: 'json_schema', json_schema: { name: rf.name, schema: rf.schema, strict: true } };
}

const STRIP_KEYS = new Set(['model', 'messages', 'stream', 'stream_options', 'input', 'prompt', 'tools', 'tool_choice', 'response_format']);

export function safeRequestParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!params) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!key) continue;
    if (STRIP_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Build the JSON body for `POST /chat/completions`. `model` is passed
 * separately by the adapter (resolved at the LLM-config layer, not part
 * of the request shape).
 */
export function buildOpenAiBody(model: string, request: LlmRequest): Record<string, unknown> {
  const requestParams = safeRequestParams(request.requestParams);
  const body: Record<string, unknown> = {
    ...requestParams,
    model,
    stream: true,
    stream_options: { include_usage: true },
    messages: toOpenAiMessages(request.messages),
  };
  const tools = toOpenAiTools(request.tools);
  if (tools) body.tools = tools;
  if (request.toolChoice) body.tool_choice = request.toolChoice;
  const rf = toOpenAiResponseFormat(request.responseFormat);
  if (rf) body.response_format = rf;
  return body;
}

/**
 * Accumulator for streaming responses. Tracks per-index tool calls (OpenAI
 * streams them as `tool_calls[i].function.arguments` deltas) and assembles a
 * final `LlmCompletion` on `finalize()`.
 */
export class OpenAiStreamAccumulator {
  private text = '';
  private thinking = '';
  private readonly toolCalls = new Map<number, { id: string; name: string; argsRaw: string }>();
  private finishReason: LlmFinishReason = 'stop';
  private usage: LlmUsage | undefined;

  constructor(private readonly emit: (event: LlmStreamEvent) => void) {}

  ingestUsage(usage: LlmUsage): void {
    this.usage = usage;
    this.emit({ type: 'usage', usage });
  }

  ingestTextDelta(delta: string): void {
    if (!delta) return;
    this.text += delta;
    this.emit({ type: 'text_delta', delta });
  }

  ingestThinkingDelta(delta: string): void {
    if (!delta) return;
    this.thinking += delta;
    this.emit({ type: 'thinking_delta', delta });
  }

  ingestToolCallDelta(index: number, fragment: { id?: string; name?: string; argsDelta?: string }): void {
    let entry = this.toolCalls.get(index);
    if (!entry) {
      entry = { id: '', name: '', argsRaw: '' };
      this.toolCalls.set(index, entry);
    }
    if (fragment.id) entry.id = fragment.id;
    if (fragment.name) entry.name = fragment.name;
    if (fragment.argsDelta) entry.argsRaw += fragment.argsDelta;
    const ev: LlmStreamEvent = { type: 'tool_call_delta', index };
    if (entry.id) ev.callId = entry.id;
    if (entry.name) ev.toolName = entry.name;
    if (fragment.argsDelta) ev.argsDelta = fragment.argsDelta;
    this.emit(ev);
  }

  ingestFinishReason(reason: LlmFinishReason): void {
    this.finishReason = reason;
  }

  hasContent(): boolean {
    return this.text.length > 0 || this.thinking.length > 0 || this.toolCalls.size > 0;
  }

  partialText(): string {
    return this.text;
  }

  finalize(): LlmCompletion {
    const parts: LlmOutputPart[] = [];
    if (this.thinking) parts.push({ kind: 'thinking', text: this.thinking });
    if (this.text) parts.push({ kind: 'text', text: this.text });
    for (const [, entry] of [...this.toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
      parts.push({
        kind: 'tool_call',
        callId: entry.id || `call_${parts.length}`,
        toolName: entry.name,
        args: parseArgsLoose(entry.argsRaw),
      });
    }
    this.emit({ type: 'finish', reason: this.finishReason });
    const completion: LlmCompletion = { parts, finishReason: this.finishReason };
    if (this.usage) completion.usage = this.usage;
    return completion;
  }
}

function parseArgsLoose(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    // Some providers emit args as a JSON string-of-a-string. Best-effort: keep raw.
    return trimmed;
  }
}

export function mapFinishReason(raw: unknown): LlmFinishReason {
  if (typeof raw !== 'string') return 'stop';
  switch (raw) {
    case 'stop':
    case 'length':
    case 'tool_calls':
    case 'content_filter':
      return raw;
    case 'function_call':
      return 'tool_calls';
    default:
      return 'stop';
  }
}

/** Parse one OpenAI SSE chunk into accumulator events. */
export function ingestOpenAiChunk(
  chunk: {
    choices?: Array<{
      delta?: {
        content?: unknown;
        reasoning_content?: unknown;
        reasoning?: unknown;
        tool_calls?: Array<{
          index?: number;
          id?: unknown;
          function?: { name?: unknown; arguments?: unknown };
        }>;
      };
      message?: { content?: unknown };
      finish_reason?: unknown;
    }>;
    usage?: unknown;
  },
  acc: OpenAiStreamAccumulator,
  parseUsage: (raw: unknown) => LlmUsage | undefined,
): void {
  const usage = parseUsage(chunk.usage);
  if (usage) acc.ingestUsage(usage);
  const choice = chunk.choices?.[0];
  if (!choice) return;
  const delta = choice.delta ?? {};
  const content = delta.content ?? choice.message?.content;
  if (typeof content === 'string') acc.ingestTextDelta(content);
  const thinking =
    typeof delta.reasoning_content === 'string'
      ? delta.reasoning_content
      : typeof delta.reasoning === 'string'
        ? delta.reasoning
        : '';
  if (thinking) acc.ingestThinkingDelta(thinking);
  if (Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls) {
      if (!tc) continue;
      const index = typeof tc.index === 'number' ? tc.index : 0;
      const fragment: { id?: string; name?: string; argsDelta?: string } = {};
      if (typeof tc.id === 'string' && tc.id) fragment.id = tc.id;
      if (typeof tc.function?.name === 'string' && tc.function.name) fragment.name = tc.function.name;
      if (typeof tc.function?.arguments === 'string') fragment.argsDelta = tc.function.arguments;
      acc.ingestToolCallDelta(index, fragment);
    }
  }
  if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
    acc.ingestFinishReason(mapFinishReason(choice.finish_reason));
  }
}
