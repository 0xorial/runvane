import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages/messages.js';
import {
  DEFAULT_MAX_TOKENS,
  buildAnthropicBody,
  ingestAnthropicEvent,
  mapAnthropicStopReason,
  newStreamState,
} from './anthropicShared.js';
import { toAnthropicConversation } from './anthropicMessages.js';
import { OpenAiStreamAccumulator } from './openAiShared.js';
import { getCompletionText, textMessage, type LlmRequest, type LlmStreamEvent } from '../types.js';

const PNG = 'iVBORw0KGgo=';

describe('buildAnthropicBody', () => {
  it('hoists leading system messages, breakpoints the last one, and caches the tail', () => {
    const request: LlmRequest = {
      messages: [textMessage('system', 'rules'), textMessage('system', 'tools'), textMessage('user', 'hi')],
    };
    const body = buildAnthropicBody('claude-opus-5-5', request);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(DEFAULT_MAX_TOKENS);
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.system).toEqual([
      { type: 'text', text: 'rules' },
      { type: 'text', text: 'tools', cache_control: { type: 'ephemeral' } },
    ]);
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
    expect(body.tools).toBeUndefined();
    expect(body.output_config).toBeUndefined();
  });

  it('turns a mid-conversation system note into a user turn', () => {
    const body = buildAnthropicBody('m', {
      messages: [
        textMessage('system', 'sys'),
        textMessage('user', 'q'),
        textMessage('assistant', 'a'),
        textMessage('system', 'retrieved context'),
        textMessage('user', 'q2'),
      ],
    });
    expect(body.system).toHaveLength(1);
    expect(body.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'user']);
    expect(body.messages[2].content).toEqual([{ type: 'text', text: 'retrieved context' }]);
  });

  it('passes requestParams through, strips adapter-owned keys, honours max_tokens', () => {
    const body = buildAnthropicBody('m', {
      messages: [textMessage('user', 'hi')],
      requestParams: {
        max_tokens: 4096,
        thinking: { type: 'adaptive', display: 'summarized' },
        model: 'override-me',
        messages: [],
        stream: false,
        output_config: { effort: 'low' },
      },
    });
    expect(body.max_tokens).toBe(4096);
    expect(body.model).toBe('m');
    expect(body.stream).toBe(true);
    expect(body.messages).toHaveLength(1);
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(body.output_config).toEqual({ effort: 'low' });
  });

  it('maps json_schema to a structured-output format and merges effort', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false };
    const body = buildAnthropicBody('m', {
      messages: [textMessage('user', 'hi')],
      responseFormat: { type: 'json_schema', name: 'out', schema },
      requestParams: { output_config: { effort: 'high' } },
    });
    expect(body.output_config).toEqual({ effort: 'high', format: { type: 'json_schema', schema } });
  });

  it('leaves json_object prompt-driven (no native equivalent)', () => {
    const body = buildAnthropicBody('m', {
      messages: [textMessage('user', 'hi')],
      responseFormat: { type: 'json_object' },
    });
    expect(body.output_config).toBeUndefined();
  });

  it('renders history tool pairs as text when the request defines no tools', () => {
    const body = buildAnthropicBody('m', {
      messages: [
        textMessage('user', 'time?'),
        { role: 'assistant', parts: [{ kind: 'tool_call', callId: 'c1', toolName: 'clock', args: { tz: 'UTC' } }] },
        { role: 'tool', parts: [{ kind: 'tool_result', callId: 'c1', ok: true, payload: '12:00' }] },
      ],
    });
    expect(body.tools).toBeUndefined();
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'time?' }] },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '<tool_call>{"name":"clock","arguments":{"tz":"UTC"}}</tool_call>' }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: '<tool_result call_id="c1" ok="true">\n12:00\n</tool_result>' }],
      },
    ]);
  });

  it('maps tools, tool choice, and history tool pairs natively when tools are defined', () => {
    const body = buildAnthropicBody('m', {
      messages: [
        textMessage('user', 'time?'),
        { role: 'assistant', parts: [{ kind: 'tool_call', callId: 'c1', toolName: 'clock', args: { tz: 'UTC' } }] },
        { role: 'tool', parts: [{ kind: 'tool_result', callId: 'c1', ok: false, payload: { error: 'down' } }] },
      ],
      tools: [{ name: 'clock', description: 'Current time', paramsSchema: { properties: { tz: { type: 'string' } } } }],
      toolChoice: 'auto',
    });
    expect(body.tools).toEqual([
      {
        name: 'clock',
        description: 'Current time',
        input_schema: { type: 'object', properties: { tz: { type: 'string' } } },
      },
    ]);
    expect(body.tool_choice).toEqual({ type: 'auto' });
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'c1', name: 'clock', input: { tz: 'UTC' } }],
    });
    expect(body.messages[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"error":"down"}', is_error: true }],
    });
  });
});

describe('toAnthropicConversation attachments and skips', () => {
  it('maps images, PDFs and text files; drops thinking and empty text', () => {
    const { messages } = toAnthropicConversation(
      [
        {
          role: 'user',
          parts: [
            { kind: 'text', text: '   ' },
            { kind: 'image', mime: 'image/png', data: { base64: PNG } },
            { kind: 'image', mime: 'image/jpeg', data: { url: 'https://x.test/a.jpg' } },
            { kind: 'file', filename: 'doc.pdf', mime: 'application/pdf', base64: 'JVBERi0=' },
            {
              kind: 'file',
              filename: 'notes.md',
              mime: 'text/markdown',
              base64: Buffer.from('# hi').toString('base64'),
            },
          ],
        },
        { role: 'assistant', parts: [{ kind: 'thinking', text: 'secret' }] },
        {
          role: 'assistant',
          parts: [
            { kind: 'thinking', text: 'secret' },
            { kind: 'text', text: 'answer' },
          ],
        },
      ],
      'text',
    );
    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
          { type: 'image', source: { type: 'url', url: 'https://x.test/a.jpg' } },
          {
            type: 'document',
            title: 'doc.pdf',
            source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' },
          },
          { type: 'document', title: 'notes.md', source: { type: 'text', media_type: 'text/plain', data: '# hi' } },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
    ]);
  });

  it('rejects attachment types the API cannot take', () => {
    expect(() =>
      toAnthropicConversation(
        [
          {
            role: 'user',
            parts: [{ kind: 'file', filename: 'a.docx', mime: 'application/vnd.openxmlformats', base64: 'AA==' }],
          },
        ],
        'text',
      ),
    ).toThrow(/unsupported attachment "a.docx"/);
    expect(() =>
      toAnthropicConversation(
        [{ role: 'user', parts: [{ kind: 'image', mime: 'image/svg+xml', data: { base64: 'AA==' } }] }],
        'text',
      ),
    ).toThrow(/unsupported image type image\/svg\+xml/);
  });
});

describe('mapAnthropicStopReason', () => {
  it('maps every documented stop reason', () => {
    expect(mapAnthropicStopReason('end_turn')).toBe('stop');
    expect(mapAnthropicStopReason('stop_sequence')).toBe('stop');
    expect(mapAnthropicStopReason('pause_turn')).toBe('stop');
    expect(mapAnthropicStopReason('max_tokens')).toBe('length');
    expect(mapAnthropicStopReason('model_context_window_exceeded')).toBe('length');
    expect(mapAnthropicStopReason('tool_use')).toBe('tool_calls');
    expect(mapAnthropicStopReason('refusal')).toBe('content_filter');
    expect(mapAnthropicStopReason(null)).toBe('stop');
  });
});

describe('ingestAnthropicEvent', () => {
  const events: RawMessageStreamEvent[] = [
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 80,
          output_tokens: 1,
        } as never,
      } as never,
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'plan' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '', citations: null } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hel' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'lo' } },
    { type: 'content_block_stop', index: 1 },
    {
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'clock', input: {} } as never,
    },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"tz":' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"UTC"}' } },
    { type: 'content_block_stop', index: 2 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null } as never,
      usage: {
        input_tokens: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        output_tokens: 20,
      } as never,
    },
    { type: 'message_stop' },
  ];

  it('assembles thinking, text, tool calls, usage and finish reason from the raw stream', () => {
    const seen: LlmStreamEvent[] = [];
    const acc = new OpenAiStreamAccumulator((e) => seen.push(e));
    const state = newStreamState();
    for (const ev of events) ingestAnthropicEvent(ev, acc, state);
    const completion = acc.finalize();

    expect(getCompletionText(completion)).toBe('Hello');
    expect(completion.parts).toEqual([
      { kind: 'thinking', text: 'plan' },
      { kind: 'text', text: 'Hello' },
      { kind: 'tool_call', callId: 'toolu_1', toolName: 'clock', args: { tz: 'UTC' } },
    ]);
    expect(completion.finishReason).toBe('tool_calls');
    expect(completion.usage).toEqual({ promptTokens: 180, completionTokens: 20, cachedPromptTokens: 80 });
    expect(completion.rawChunks).toEqual(events);
    expect(seen.filter((e) => e.type === 'tool_call_delta').map((e) => (e as { index: number }).index)).toEqual([
      0, 0, 0,
    ]);
    expect(seen.at(-1)).toEqual({ type: 'finish', reason: 'tool_calls' });
  });
});
