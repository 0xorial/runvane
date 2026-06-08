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
  private generationId: string | undefined;

  constructor(private readonly emit: (event: LlmStreamEvent) => void) {}

  ingestGenerationId(id: string): void {
    if (id) this.generationId = id;
  }

  generationIdValue(): string | undefined {
    return this.generationId;
  }

  usageValue(): LlmUsage | undefined {
    return this.usage;
  }

  ingestUsage(usage: LlmUsage): void {
    this.usage = this.usage ? mergeLlmUsage(this.usage, usage) : usage;
    this.emit({ type: 'usage', usage: this.usage });
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

function finiteTokenCount(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : undefined;
}

function detailsObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

/** Parse OpenAI Chat Completions `usage` (incl. OpenRouter + Anthropic-native fields). */
export function parseChatCompletionsUsage(usage: unknown): LlmUsage | undefined {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return undefined;
  const rec = usage as Record<string, unknown>;
  const pt = finiteTokenCount(rec.prompt_tokens) ?? finiteTokenCount(rec.input_tokens);
  const ct = finiteTokenCount(rec.completion_tokens) ?? finiteTokenCount(rec.output_tokens);
  const promptDetails = detailsObject(rec.prompt_tokens_details);
  const inputDetails = detailsObject(rec.input_tokens_details);
  const cachedPromptTokens =
    finiteTokenCount(promptDetails?.cached_tokens) ??
    finiteTokenCount(inputDetails?.cached_tokens) ??
    finiteTokenCount(rec.cache_read_input_tokens);
  const costUsd =
    typeof rec.cost === 'number' && Number.isFinite(rec.cost) ? rec.cost : undefined;
  if (pt !== undefined && ct !== undefined) {
    return {
      promptTokens: pt,
      completionTokens: ct,
      ...(cachedPromptTokens !== undefined ? { cachedPromptTokens: Math.min(cachedPromptTokens, pt) } : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
    };
  }
  const total = finiteTokenCount(rec.total_tokens);
  if (total !== undefined && pt !== undefined) {
    return {
      promptTokens: pt,
      completionTokens: Math.max(0, total - pt),
      ...(cachedPromptTokens !== undefined ? { cachedPromptTokens: Math.min(cachedPromptTokens, pt) } : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
    };
  }
  return undefined;
}

export function isAnthropicOpenRouterModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.startsWith('anthropic/') || normalized.startsWith('~anthropic/');
}

function cachedTextBlock(text: string): Array<Record<string, unknown>> {
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

function markCacheBreakpoint(messages: OpenAiMessage[], idx: number): void {
  const msg = messages[idx];
  if (!msg) return;
  if (typeof msg.content === 'string' && msg.content.length > 0) {
    messages[idx] = { ...msg, content: cachedTextBlock(msg.content) };
    return;
  }
  if (!Array.isArray(msg.content) || msg.content.length === 0) return;
  const parts = msg.content.map((part) => ({ ...part }));
  const lastPart = parts[parts.length - 1];
  if (lastPart?.type !== 'text' || typeof lastPart.text !== 'string') return;
  parts[parts.length - 1] = { ...lastPart, cache_control: { type: 'ephemeral' } };
  messages[idx] = { ...msg, content: parts };
}

/**
 * Anthropic via OpenRouter needs explicit `cache_control` on content blocks
 * (top-level alone is not enough on all routes). Breakpoint the stable system
 * prompt and the turn immediately before the latest user message.
 */
export function withAnthropicCacheBreakpoints(messages: OpenAiMessage[]): OpenAiMessage[] {
  if (messages.length === 0) return messages;
  const out = messages.map((m) => ({ ...m }));
  const sysIdx = out.findIndex((m) => m.role === 'system');
  if (sysIdx >= 0) markCacheBreakpoint(out, sysIdx);
  const last = out[out.length - 1];
  if (out.length >= 2 && last.role === 'user') {
    markCacheBreakpoint(out, out.length - 2);
  }
  return out;
}

function mergeLlmUsage(prev: LlmUsage, next: LlmUsage): LlmUsage {
  const cachedPromptTokens =
    next.cachedPromptTokens !== undefined
      ? next.cachedPromptTokens
      : prev.cachedPromptTokens;
  return {
    promptTokens: next.promptTokens || prev.promptTokens,
    completionTokens: next.completionTokens || prev.completionTokens,
    ...(cachedPromptTokens !== undefined ? { cachedPromptTokens } : {}),
    reasoningTokens: next.reasoningTokens ?? prev.reasoningTokens,
    costUsd: next.costUsd ?? prev.costUsd,
  };
}

/** OpenRouter body: Anthropic prompt caching + first-party routing. */
export function buildOpenRouterBody(model: string, request: LlmRequest): Record<string, unknown> {
  const body = buildOpenAiBody(model, request);
  if (!isAnthropicOpenRouterModel(model)) return body;
  if (body.cache_control == null) {
    body.cache_control = { type: 'ephemeral' };
  }
  if (Array.isArray(body.messages)) {
    body.messages = withAnthropicCacheBreakpoints(body.messages as OpenAiMessage[]);
  }
  if (body.provider == null) {
    body.provider = { only: ['anthropic'] };
  }
  return body;
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
    id?: unknown;
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
  if (typeof chunk.id === 'string' && chunk.id.trim()) acc.ingestGenerationId(chunk.id.trim());
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
