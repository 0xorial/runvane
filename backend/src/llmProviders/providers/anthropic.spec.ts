import { AnthropicProvider } from './anthropic.js';
import {
  AnthropicStreamAccumulator,
  buildAnthropicBody,
  parseAnthropicUsage,
  toAnthropicMessages,
  withAnthropicNativeCacheBreakpoints,
} from './anthropicShared.js';
import { StreamInterruptedError } from '../provider.js';
import type { LlmRequest, LlmStreamEvent } from '../types.js';

describe('toAnthropicMessages', () => {
  it('hoists the leading system message and folds mid-conversation system notes into user turns', () => {
    const { system, messages } = toAnthropicMessages([
      { role: 'system', parts: [{ kind: 'text', text: 'planner prompt' }] },
      { role: 'user', parts: [{ kind: 'text', text: 'hi' }] },
      { role: 'assistant', parts: [{ kind: 'text', text: 'hello' }] },
      { role: 'system', parts: [{ kind: 'text', text: '[tools changed]' }] },
      { role: 'user', parts: [{ kind: 'text', text: 'next' }] },
    ]);
    expect(system).toEqual([{ type: 'text', text: 'planner prompt' }]);
    expect(messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      {
        role: 'user',
        content: [
          { type: 'text', text: '[tools changed]' },
          { type: 'text', text: 'next' },
        ],
      },
    ]);
  });

  it('renders tool pairs natively and keeps strict role alternation', () => {
    const { messages } = toAnthropicMessages([
      { role: 'user', parts: [{ kind: 'text', text: 'read it' }] },
      {
        role: 'assistant',
        parts: [{ kind: 'tool_call', callId: 'c1', toolName: 'filesystem', args: { path: '/a' } }],
      },
      { role: 'tool', parts: [{ kind: 'tool_result', callId: 'c1', ok: false, payload: 'ENOENT' }] },
      { role: 'user', parts: [{ kind: 'text', text: 'hm?' }] },
    ]);
    expect(messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'read it' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'c1', name: 'filesystem', input: { path: '/a' } }],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'c1',
            content: [{ type: 'text', text: 'ENOENT' }],
            is_error: true,
          },
          { type: 'text', text: 'hm?' },
        ],
      },
    ]);
  });

  it('maps images and pdf files to native blocks', () => {
    const { messages } = toAnthropicMessages([
      {
        role: 'user',
        parts: [
          { kind: 'image', mime: 'image/png', data: { base64: 'AAAA' } },
          { kind: 'file', filename: 'doc.pdf', mime: 'application/pdf', base64: 'UERG' },
        ],
      },
    ]);
    expect(messages[0].content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'UERG' }, title: 'doc.pdf' },
    ]);
  });
});

describe('withAnthropicNativeCacheBreakpoints', () => {
  it('marks the system prompt and the last two user turns', () => {
    const prompt = withAnthropicNativeCacheBreakpoints(
      toAnthropicMessages([
        { role: 'system', parts: [{ kind: 'text', text: 'sys' }] },
        { role: 'user', parts: [{ kind: 'text', text: 'u1' }] },
        { role: 'assistant', parts: [{ kind: 'text', text: 'a1' }] },
        { role: 'user', parts: [{ kind: 'text', text: 'u2' }] },
        { role: 'assistant', parts: [{ kind: 'text', text: 'a2' }] },
        { role: 'user', parts: [{ kind: 'text', text: 'u3' }] },
      ]),
    );
    expect(prompt.system?.[0].cache_control).toEqual({ type: 'ephemeral' });
    const marked = prompt.messages.map(
      (m) => m.content[m.content.length - 1].cache_control !== undefined,
    );
    // u1 unmarked; u2 and u3 (last two user turns) marked; assistants unmarked.
    expect(marked).toEqual([false, false, true, false, true]);
  });
});

describe('buildAnthropicBody', () => {
  it('assembles model, tools, tool_choice, and default max_tokens', () => {
    const request: LlmRequest = {
      messages: [{ role: 'user', parts: [{ kind: 'text', text: 'hi' }] }],
      tools: [{ name: 'todo_write', description: 'Track todos.', paramsSchema: { type: 'object' } }],
      toolChoice: 'required',
      requestParams: { temperature: 0.2 },
    };
    const body = buildAnthropicBody('claude-sonnet-5', request);
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(32000);
    expect(body.temperature).toBe(0.2);
    expect(body.tools).toEqual([
      { name: 'todo_write', description: 'Track todos.', input_schema: { type: 'object' } },
    ]);
    expect(body.tool_choice).toEqual({ type: 'any' });
  });

  it('lets requestParams override max_tokens', () => {
    const body = buildAnthropicBody('claude-haiku-4-5', {
      messages: [{ role: 'user', parts: [{ kind: 'text', text: 'hi' }] }],
      requestParams: { max_tokens: 4096 },
    });
    expect(body.max_tokens).toBe(4096);
  });
});

describe('parseAnthropicUsage', () => {
  it('folds cache tokens into promptTokens', () => {
    expect(
      parseAnthropicUsage({
        input_tokens: 10,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 10,
        output_tokens: 6,
      }),
    ).toEqual({ promptTokens: 100, completionTokens: 6, cachedPromptTokens: 80 });
  });
});

describe('AnthropicStreamAccumulator', () => {
  it('assembles thinking, text, and tool_use blocks with parsed args', () => {
    const events: LlmStreamEvent[] = [];
    const acc = new AnthropicStreamAccumulator((e) => events.push(e));
    acc.ingest({ type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 0 } } });
    acc.ingest({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } });
    acc.ingest({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } });
    acc.ingest({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } });
    acc.ingest({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello' } });
    acc.ingest({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tu1', name: 'todo_write' } });
    acc.ingest({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"todos"' } });
    acc.ingest({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: ':[]}' } });
    acc.ingest({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } });

    const completion = acc.finalize();
    expect(completion.parts).toEqual([
      { kind: 'thinking', text: 'hm' },
      { kind: 'text', text: 'Hello' },
      { kind: 'tool_call', callId: 'tu1', toolName: 'todo_write', args: { todos: [] } },
    ]);
    expect(completion.finishReason).toBe('tool_calls');
    expect(completion.usage).toEqual({ promptTokens: 5, completionTokens: 9 });
    expect(events.filter((e) => e.type === 'text_delta')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'tool_call_delta')).toHaveLength(3);
    expect(events[events.length - 1]).toEqual({ type: 'finish', reason: 'tool_calls' });
  });

  it('throws on stream error events', () => {
    const acc = new AnthropicStreamAccumulator(() => {});
    expect(() =>
      acc.ingest({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }),
    ).toThrow(/overloaded_error.*Overloaded/);
  });
});

function sseResponse(events: Array<Record<string, unknown>>): Response {
  const body = (async function* () {
    const encoder = new TextEncoder();
    for (const e of events) {
      yield encoder.encode(`event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`);
    }
  })();
  return {
    ok: true,
    status: 200,
    body: body as unknown,
    text: async () => '',
    json: async () => ({}),
  } as unknown as Response;
}

const SETTINGS = { api_key: 'sk-ant-test', base_url: 'https://api.anthropic.com' };
const REQUEST: LlmRequest = { messages: [{ role: 'user', parts: [{ kind: 'text', text: 'hi' }] }] };

describe('AnthropicProvider.streamCompletion', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('streams a completion end-to-end and reports usage', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    global.fetch = (async (url: unknown, init: unknown) => {
      captured = { url: String(url), init: init as RequestInit };
      return sseResponse([
        { type: 'message_start', message: { usage: { input_tokens: 3, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hey' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
        { type: 'message_stop' },
      ]);
    }) as typeof fetch;

    const provider = new AnthropicProvider();
    const events: LlmStreamEvent[] = [];
    const completion = await provider.streamCompletion(SETTINGS, 'claude-sonnet-5', REQUEST, (e) =>
      events.push(e),
    );
    expect(completion.parts).toEqual([{ kind: 'text', text: 'Hey' }]);
    expect(completion.usage).toEqual({ promptTokens: 3, completionTokens: 2 });
    expect(events.some((e) => e.type === 'text_delta')).toBe(true);

    expect(captured!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(captured!.init.body));
    expect(body.stream).toBe(true);
    expect(body.messages[0].role).toBe('user');
  });

  it('resolves an empty stream as a no-op completion', async () => {
    global.fetch = (async () =>
      sseResponse([
        { type: 'message_start', message: { usage: { input_tokens: 3, output_tokens: 0 } } },
        { type: 'message_stop' },
      ])) as typeof fetch;
    const provider = new AnthropicProvider();
    const completion = await provider.streamCompletion(SETTINGS, 'claude-sonnet-5', REQUEST, () => {});
    expect(completion.parts).toEqual([]);
    expect(completion.finishReason).toBe('stop');
  });

  it('wraps aborts in StreamInterruptedError with the partial text', async () => {
    global.fetch = (async () => {
      const encoder = new TextEncoder();
      const body = (async function* () {
        yield encoder.encode(
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n',
        );
        yield encoder.encode(
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"par"}}\n',
        );
        const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
        throw abortError;
      })();
      return { ok: true, status: 200, body } as unknown as Response;
    }) as typeof fetch;

    const provider = new AnthropicProvider();
    const err = await provider
      .streamCompletion(SETTINGS, 'claude-sonnet-5', REQUEST, () => {})
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StreamInterruptedError);
    expect((err as StreamInterruptedError).partialText).toBe('par');
  });

  it('throws an actionable error on a non-2xx response', async () => {
    global.fetch = (async () =>
      ({
        ok: false,
        status: 401,
        text: async () => '{"type":"error","error":{"type":"authentication_error"}}',
      }) as unknown as Response) as typeof fetch;
    const provider = new AnthropicProvider();
    await expect(
      provider.streamCompletion(SETTINGS, 'claude-sonnet-5', REQUEST, () => {}),
    ).rejects.toThrow(/llm request failed \(401\)/);
  });
});

describe('AnthropicProvider.listModels / checkConnectivity', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('lists model ids from /v1/models', async () => {
    global.fetch = (async (url: unknown) => {
      expect(String(url)).toBe('https://api.anthropic.com/v1/models?limit=1000');
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'claude-sonnet-5' }, { id: 'claude-haiku-4-5' }] }),
      } as unknown as Response;
    }) as typeof fetch;
    const provider = new AnthropicProvider();
    await expect(provider.listModels(SETTINGS)).resolves.toEqual(['claude-sonnet-5', 'claude-haiku-4-5']);
  });

  it('reports missing key without a network call', async () => {
    const provider = new AnthropicProvider();
    await expect(provider.checkConnectivity({ base_url: 'https://api.anthropic.com' })).resolves.toEqual({
      ok: false,
      detail: 'api_key is required',
    });
  });
});
