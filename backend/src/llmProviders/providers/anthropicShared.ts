import type {
  LlmCompletion,
  LlmContentPart,
  LlmFinishReason,
  LlmMessage,
  LlmOutputPart,
  LlmStreamEvent,
  LlmRequest,
  LlmToolSpec,
  LlmUsage,
} from '../types.js';
import { safeRequestParams } from './openAiShared.js';

/**
 * Native Anthropic Messages API translation (anthropic.ts):
 *   LlmRequest  -> POST /v1/messages body
 *   SSE stream  -> LlmStreamEvent[] + accumulated LlmCompletion
 *
 * Unlike the Agent-SDK provider, this speaks the wire format directly: real
 * role-based history with `tool_use`/`tool_result` blocks, native `tools`
 * with input_schema, and explicit `cache_control` breakpoints placed so the
 * previous round's prefix survives into the next request (incremental
 * prompt caching, which the flattened-transcript SDK path cannot get).
 */

type AnthropicBlock = Record<string, unknown>;
export type AnthropicMessage = { role: 'user' | 'assistant'; content: AnthropicBlock[] };

function stringifyLoose(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? '');
  } catch {
    return String(value);
  }
}

function decodeUtf8(base64: string): string | null {
  try {
    return Buffer.from(base64, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function userPartToBlocks(part: LlmContentPart): AnthropicBlock[] {
  switch (part.kind) {
    case 'text':
      return [{ type: 'text', text: part.text }];
    case 'image':
      return [
        {
          type: 'image',
          source:
            'base64' in part.data
              ? { type: 'base64', media_type: part.mime, data: part.data.base64 }
              : { type: 'url', url: part.data.url },
        },
      ];
    case 'file': {
      if (part.mime === 'application/pdf') {
        return [
          {
            type: 'document',
            source: { type: 'base64', media_type: part.mime, data: part.base64 },
            title: part.filename,
          },
        ];
      }
      const text = part.mime.startsWith('text/') ? decodeUtf8(part.base64) : null;
      return [
        {
          type: 'text',
          text:
            text !== null
              ? `[Attached file "${part.filename}" (${part.mime})]\n${text}`
              : `[Attached file "${part.filename}" (${part.mime}) — binary content not shown]`,
        },
      ];
    }
    case 'attachment_ref':
      // Expanded before adapters run; visible placeholder if one leaks through.
      return [{ type: 'text', text: `[Attachment "${part.filename}" (${part.mime}) — content unavailable]` }];
    case 'tool_result':
      return [
        {
          type: 'tool_result',
          tool_use_id: part.callId,
          content: [{ type: 'text', text: stringifyLoose(part.payload) }],
          ...(part.ok ? {} : { is_error: true }),
        },
      ];
    default:
      // tool_call / thinking never occur on user-side messages.
      return [];
  }
}

export type AnthropicPrompt = { system: AnthropicBlock[] | undefined; messages: AnthropicMessage[] };

/**
 * Canonical messages -> top-level `system` + alternating user/assistant turns.
 * The Messages API has no system role in `messages`, so only the LEADING
 * system message becomes the system param; mid-conversation system notes
 * (checkpoint folds, retrieval context, tool-change notes) fold into user
 * turns — their text is already self-describing bracketed context. Tool
 * results become `tool_result` blocks on a user turn, and consecutive
 * same-role turns are merged to keep strict alternation.
 */
export function toAnthropicMessages(messages: LlmMessage[]): AnthropicPrompt {
  let system: AnthropicBlock[] | undefined;
  let rest = messages;
  if (rest.length > 0 && rest[0].role === 'system') {
    const text = rest[0].parts
      .filter((p): p is Extract<LlmContentPart, { kind: 'text' }> => p.kind === 'text')
      .map((p) => p.text)
      .join('\n\n');
    if (text.length > 0) system = [{ type: 'text', text }];
    rest = rest.slice(1);
  }

  const out: AnthropicMessage[] = [];
  const push = (role: 'user' | 'assistant', blocks: AnthropicBlock[]): void => {
    if (blocks.length === 0) return;
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.content.push(...blocks);
    else out.push({ role, content: blocks });
  };

  for (const message of rest) {
    if (message.role === 'assistant') {
      const blocks: AnthropicBlock[] = [];
      for (const part of message.parts) {
        if (part.kind === 'text') blocks.push({ type: 'text', text: part.text });
        else if (part.kind === 'tool_call') {
          let input: unknown = part.args;
          if (typeof input === 'string') {
            try {
              input = JSON.parse(input);
            } catch {
              input = {};
            }
          }
          blocks.push({ type: 'tool_use', id: part.callId, name: part.toolName, input: input ?? {} });
        }
        // thinking: unsigned thinking blocks cannot be replayed — dropped.
      }
      push('assistant', blocks);
      continue;
    }
    // user, tool, and mid-conversation system all land on the user side.
    push(
      'user',
      message.parts.flatMap((part) => userPartToBlocks(part)),
    );
  }
  return { system, messages: out };
}

export function toAnthropicTools(
  tools: LlmToolSpec[] | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.paramsSchema }));
}

function markLastBlock(blocks: AnthropicBlock[]): void {
  const last = blocks[blocks.length - 1];
  if (last) last.cache_control = { type: 'ephemeral' };
}

/**
 * Cache breakpoints (4 allowed; 3 used): the system prompt, the LAST user
 * turn, and the SECOND-TO-LAST user turn. The latter is what makes caching
 * incremental — next round, this request's final breakpoint still exists as
 * a marked boundary in the grown history, so its cache entry gets hit.
 */
export function withAnthropicNativeCacheBreakpoints(prompt: AnthropicPrompt): AnthropicPrompt {
  if (prompt.system) markLastBlock(prompt.system);
  const userIdx = prompt.messages
    .map((m, i) => (m.role === 'user' ? i : -1))
    .filter((i) => i >= 0);
  for (const i of userIdx.slice(-2)) markLastBlock(prompt.messages[i].content);
  return prompt;
}

const DEFAULT_MAX_TOKENS = 32000;

/** Build the JSON body for `POST /v1/messages`. */
export function buildAnthropicBody(model: string, request: LlmRequest): Record<string, unknown> {
  const requestParams = safeRequestParams(request.requestParams);
  const prompt = withAnthropicNativeCacheBreakpoints(toAnthropicMessages(request.messages));
  const maxTokens =
    typeof requestParams.max_tokens === 'number' && requestParams.max_tokens > 0
      ? requestParams.max_tokens
      : DEFAULT_MAX_TOKENS;
  const body: Record<string, unknown> = {
    ...requestParams,
    model,
    max_tokens: maxTokens,
    stream: true,
    messages: prompt.messages,
  };
  if (prompt.system) body.system = prompt.system;
  const tools = toAnthropicTools(request.tools);
  if (tools) body.tools = tools;
  if (request.toolChoice) {
    body.tool_choice =
      request.toolChoice === 'required' ? { type: 'any' } : { type: request.toolChoice };
  }
  // responseFormat is not enforced here: the planner's prompts already ask
  // for JSON and the dialect parsers handle the reply either way.
  return body;
}

export function parseAnthropicUsage(raw: unknown): LlmUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const input = num(rec.input_tokens);
  const cacheRead = num(rec.cache_read_input_tokens);
  const cacheCreation = num(rec.cache_creation_input_tokens);
  const output = num(rec.output_tokens);
  if (input + cacheRead + cacheCreation + output === 0) return undefined;
  return {
    // Same convention as the rest of the app (OpenAI-style): promptTokens is
    // the full prompt context, cachedPromptTokens the cache-read share.
    promptTokens: input + cacheRead + cacheCreation,
    completionTokens: output,
    ...(cacheRead > 0 ? { cachedPromptTokens: cacheRead } : {}),
  };
}

function mapStopReason(reason: unknown): LlmFinishReason {
  switch (reason) {
    case 'max_tokens':
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
 * Accumulator for the Messages API SSE stream (message_start /
 * content_block_start / content_block_delta / message_delta / message_stop).
 * Same contract as OpenAiStreamAccumulator: feed parsed event JSON via
 * `ingest`, read `finalize()` for the completed LlmCompletion.
 */
export class AnthropicStreamAccumulator {
  private readonly blocks = new Map<
    number,
    | { kind: 'text'; text: string }
    | { kind: 'thinking'; text: string }
    | { kind: 'tool_call'; callId: string; toolName: string; argsJson: string }
  >();
  private order: number[] = [];
  private usage: LlmUsage | undefined;
  private finishReason: LlmFinishReason = 'stop';
  private rawChunks: unknown[] = [];

  constructor(private readonly onEvent: (event: LlmStreamEvent) => void) {}

  recordRawChunk(chunk: unknown): void {
    this.rawChunks.push(chunk);
  }

  private mergeUsage(next: LlmUsage | undefined): void {
    if (!next) return;
    const prev = this.usage;
    this.usage = prev
      ? {
          promptTokens: next.promptTokens || prev.promptTokens,
          completionTokens: next.completionTokens || prev.completionTokens,
          ...((next.cachedPromptTokens ?? prev.cachedPromptTokens) !== undefined
            ? { cachedPromptTokens: next.cachedPromptTokens ?? prev.cachedPromptTokens }
            : {}),
        }
      : next;
    this.onEvent({ type: 'usage', usage: this.usage });
  }

  ingest(event: Record<string, unknown>): void {
    const type = event.type;
    if (type === 'error') {
      const err = (event.error ?? {}) as { type?: unknown; message?: unknown };
      throw new Error(`llm stream error (${String(err.type ?? 'unknown')}): ${String(err.message ?? '')}`);
    }
    if (type === 'message_start') {
      const message = (event.message ?? {}) as { usage?: unknown };
      this.mergeUsage(parseAnthropicUsage(message.usage));
      return;
    }
    if (type === 'content_block_start') {
      const index = Number(event.index ?? this.order.length);
      const block = (event.content_block ?? {}) as Record<string, unknown>;
      if (block.type === 'text') this.blocks.set(index, { kind: 'text', text: String(block.text ?? '') });
      else if (block.type === 'thinking') this.blocks.set(index, { kind: 'thinking', text: '' });
      else if (block.type === 'tool_use') {
        this.blocks.set(index, {
          kind: 'tool_call',
          callId: String(block.id ?? ''),
          toolName: String(block.name ?? ''),
          argsJson: '',
        });
        this.onEvent({
          type: 'tool_call_delta',
          index,
          callId: String(block.id ?? ''),
          toolName: String(block.name ?? ''),
        });
      } else return; // redacted_thinking etc. — not represented
      if (!this.order.includes(index)) this.order.push(index);
      return;
    }
    if (type === 'content_block_delta') {
      const index = Number(event.index ?? -1);
      const delta = (event.delta ?? {}) as Record<string, unknown>;
      const block = this.blocks.get(index);
      if (!block) return;
      if (delta.type === 'text_delta' && block.kind === 'text' && typeof delta.text === 'string') {
        block.text += delta.text;
        this.onEvent({ type: 'text_delta', delta: delta.text });
      } else if (delta.type === 'thinking_delta' && block.kind === 'thinking' && typeof delta.thinking === 'string') {
        block.text += delta.thinking;
        this.onEvent({ type: 'thinking_delta', delta: delta.thinking });
      } else if (delta.type === 'input_json_delta' && block.kind === 'tool_call' && typeof delta.partial_json === 'string') {
        block.argsJson += delta.partial_json;
        this.onEvent({ type: 'tool_call_delta', index, argsDelta: delta.partial_json });
      }
      return;
    }
    if (type === 'message_delta') {
      const delta = (event.delta ?? {}) as Record<string, unknown>;
      if (delta.stop_reason != null) this.finishReason = mapStopReason(delta.stop_reason);
      this.mergeUsage(parseAnthropicUsage(event.usage));
      return;
    }
    // message_stop / ping: nothing to do.
  }

  partialText(): string {
    return this.order
      .map((i) => this.blocks.get(i))
      .filter((b): b is { kind: 'text'; text: string } => b?.kind === 'text')
      .map((b) => b.text)
      .join('');
  }

  usageValue(): LlmUsage | undefined {
    return this.usage;
  }

  hasContent(): boolean {
    return this.order.length > 0;
  }

  finalize(): LlmCompletion {
    const parts: LlmOutputPart[] = [];
    for (const index of this.order) {
      const block = this.blocks.get(index);
      if (!block) continue;
      if (block.kind === 'text') parts.push({ kind: 'text', text: block.text });
      else if (block.kind === 'thinking') parts.push({ kind: 'thinking', text: block.text });
      else {
        let args: unknown = {};
        if (block.argsJson.trim().length > 0) {
          try {
            args = JSON.parse(block.argsJson);
          } catch {
            args = block.argsJson;
          }
        }
        parts.push({ kind: 'tool_call', callId: block.callId, toolName: block.toolName, args });
      }
    }
    this.onEvent({ type: 'finish', reason: this.finishReason });
    return {
      parts,
      finishReason: this.finishReason,
      ...(this.usage ? { usage: this.usage } : {}),
      rawChunks: this.rawChunks,
    };
  }
}
