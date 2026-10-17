import type {
  MessageCreateParamsStreaming,
  MessageDeltaUsage,
  OutputConfig,
  RawMessageStreamEvent,
  Tool,
  ToolChoice,
  Usage,
} from '@anthropic-ai/sdk/resources/messages/messages.js';
import type { LlmFinishReason, LlmRequest, LlmToolSpec, LlmUsage } from '../types.js';
import { toAnthropicConversation } from './anthropicMessages.js';
import type { OpenAiStreamAccumulator } from './openAiShared.js';

/**
 * Canonical translation for the native Anthropic Messages API:
 *   LlmRequest           -> `POST /v1/messages` body (streaming)
 *   RawMessageStreamEvent -> accumulator events (+ usage)
 *
 * The accumulator is the OpenAI one: it is wire-format agnostic (text /
 * thinking / tool-call deltas, usage, finish) and reusing it keeps the two
 * adapters' output identical for the raw-response and assembled views.
 */

/**
 * Fits every current model's output cap (Claude 4.6+: 128K; the smallest
 * still-served cap is 32K) and leaves room for adaptive thinking, which
 * counts toward `max_tokens`. Override per request with
 * `requestParams.max_tokens`.
 */
export const DEFAULT_MAX_TOKENS = 32_000;

/** Keys the adapter owns; a stray copy in `requestParams` must not override them. */
const STRIP_KEYS = new Set(['model', 'messages', 'system', 'stream', 'tools', 'tool_choice']);

function safeRequestParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!params) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!key || STRIP_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export function toAnthropicTools(tools: LlmToolSpec[] | undefined): Tool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: toInputSchema(t.paramsSchema),
  }));
}

function toInputSchema(schema: unknown): Tool.InputSchema {
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    return { ...(schema as Record<string, unknown>), type: 'object' };
  }
  return { type: 'object' };
}

/**
 * `required` maps to `{type: "any"}`, which Claude Opus 5.5, Sonnet 5.5 and
 * Fable 5.1 reject with a 400 (forced tool use removed) — kept as the
 * faithful translation; callers that target those models use `auto`.
 */
export function toAnthropicToolChoice(choice: LlmRequest['toolChoice']): ToolChoice | undefined {
  switch (choice) {
    case 'auto':
      return { type: 'auto' };
    case 'none':
      return { type: 'none' };
    case 'required':
      return { type: 'any' };
    default:
      return undefined;
  }
}

/**
 * `json_schema` becomes a structured-output format. `json_object` has no
 * native equivalent (Anthropic only offers schema-bound JSON), so it stays
 * prompt-driven, exactly as OpenAI's json_object mode requires anyway.
 */
export function toAnthropicOutputConfig(
  responseFormat: LlmRequest['responseFormat'],
  fromParams: unknown,
): OutputConfig | undefined {
  const base: OutputConfig =
    fromParams && typeof fromParams === 'object' && !Array.isArray(fromParams)
      ? { ...(fromParams as OutputConfig) }
      : {};
  if (responseFormat?.type === 'json_schema') {
    base.format = { type: 'json_schema', schema: responseFormat.schema as Record<string, unknown> };
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

/**
 * Build the streaming `POST /v1/messages` body. Caching: one explicit
 * breakpoint on the last system block (the stable prefix every planner turn
 * shares) plus the top-level automatic breakpoint, which the API moves along
 * the growing conversation tail — the documented combination for agent loops.
 */
export function buildAnthropicBody(model: string, request: LlmRequest): MessageCreateParamsStreaming {
  const params = safeRequestParams(request.requestParams);
  const tools = toAnthropicTools(request.tools);
  const { system, messages } = toAnthropicConversation(request.messages, tools ? 'native' : 'text');
  const maxTokens =
    typeof params.max_tokens === 'number' && Number.isFinite(params.max_tokens) && params.max_tokens > 0
      ? Math.trunc(params.max_tokens)
      : DEFAULT_MAX_TOKENS;
  const outputConfig = toAnthropicOutputConfig(request.responseFormat, params.output_config);
  const body = {
    ...params,
    model,
    max_tokens: maxTokens,
    stream: true as const,
    messages,
    cache_control: { type: 'ephemeral' as const },
  } as MessageCreateParamsStreaming;
  if (system.length > 0) {
    const last = system[system.length - 1];
    body.system = [...system.slice(0, -1), { ...last, cache_control: { type: 'ephemeral' } }];
  }
  if (tools) body.tools = tools;
  const toolChoice = toAnthropicToolChoice(request.toolChoice);
  if (toolChoice) body.tool_choice = toolChoice;
  if (outputConfig) body.output_config = outputConfig;
  else delete body.output_config;
  return body;
}

export function mapAnthropicStopReason(raw: string | null | undefined): LlmFinishReason {
  switch (raw) {
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    case 'refusal':
      return 'content_filter';
    default:
      return 'stop';
  }
}

/**
 * Usage arrives in two halves: `message_start` carries the input-side
 * counts, `message_delta` the final output count (and sometimes refreshed
 * input counts). Each half is a partial; this keeps the running totals.
 */
export type AnthropicUsageState = {
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
  seen: boolean;
};

export function newUsageState(): AnthropicUsageState {
  return { input: 0, cacheCreation: 0, cacheRead: 0, output: 0, seen: false };
}

function count(raw: number | null | undefined): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : undefined;
}

export function ingestAnthropicUsage(
  state: AnthropicUsageState,
  usage: Partial<Usage> | Partial<MessageDeltaUsage> | null | undefined,
): void {
  if (!usage) return;
  state.seen = true;
  state.input = count(usage.input_tokens) ?? state.input;
  state.cacheCreation = count(usage.cache_creation_input_tokens) ?? state.cacheCreation;
  state.cacheRead = count(usage.cache_read_input_tokens) ?? state.cacheRead;
  state.output = count(usage.output_tokens) ?? state.output;
}

/**
 * `promptTokens` is the whole prompt (uncached + cache writes + cache reads),
 * `cachedPromptTokens` the cache-read share — the convention the OpenAI
 * adapters follow. Cache writes (billed 1.25x) are counted as plain input;
 * the usage model has no slot for them.
 */
export function toLlmUsage(state: AnthropicUsageState): LlmUsage | undefined {
  if (!state.seen) return undefined;
  return {
    promptTokens: state.input + state.cacheCreation + state.cacheRead,
    completionTokens: state.output,
    cachedPromptTokens: state.cacheRead,
  };
}

/**
 * Per-stream bookkeeping the accumulator does not know about: Anthropic
 * content-block indexes count text/thinking blocks too, while the stream
 * events expose tool calls by a dense ordinal.
 */
export type AnthropicStreamState = {
  usage: AnthropicUsageState;
  toolOrdinalByBlock: Map<number, number>;
};

export function newStreamState(): AnthropicStreamState {
  return { usage: newUsageState(), toolOrdinalByBlock: new Map() };
}

/** Fold one raw stream event into the accumulator. */
export function ingestAnthropicEvent(
  event: RawMessageStreamEvent,
  acc: OpenAiStreamAccumulator,
  state: AnthropicStreamState,
): void {
  acc.recordRawChunk(event);
  switch (event.type) {
    case 'message_start': {
      if (event.message?.id) acc.ingestGenerationId(event.message.id);
      ingestAnthropicUsage(state.usage, event.message?.usage);
      const usage = toLlmUsage(state.usage);
      if (usage) acc.ingestUsage(usage);
      return;
    }
    case 'content_block_start': {
      const block = event.content_block;
      if (block.type === 'tool_use') {
        const ordinal = state.toolOrdinalByBlock.size;
        state.toolOrdinalByBlock.set(event.index, ordinal);
        acc.ingestToolCallDelta(ordinal, { id: block.id, name: block.name });
      } else if (block.type === 'text') {
        acc.ingestTextDelta(block.text);
      } else if (block.type === 'thinking') {
        acc.ingestThinkingDelta(block.thinking);
      }
      return;
    }
    case 'content_block_delta': {
      const delta = event.delta;
      if (delta.type === 'text_delta') acc.ingestTextDelta(delta.text);
      else if (delta.type === 'thinking_delta') acc.ingestThinkingDelta(delta.thinking);
      else if (delta.type === 'input_json_delta') {
        const ordinal = state.toolOrdinalByBlock.get(event.index);
        if (ordinal !== undefined) acc.ingestToolCallDelta(ordinal, { argsDelta: delta.partial_json });
      }
      return;
    }
    case 'message_delta': {
      if (event.delta?.stop_reason) acc.ingestFinishReason(mapAnthropicStopReason(event.delta.stop_reason));
      ingestAnthropicUsage(state.usage, event.usage);
      const usage = toLlmUsage(state.usage);
      if (usage) acc.ingestUsage(usage);
      return;
    }
    case 'content_block_stop':
    case 'message_stop':
      return;
  }
}
