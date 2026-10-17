import { getCompletionText, getCompletionToolCalls, textMessage, type LlmMessage } from '../types.js';
import { AnthropicProvider } from './anthropic.js';

/**
 * Live checks against api.anthropic.com. Skipped unless ANTHROPIC_LIVE_API_KEY
 * is set; spends a few cents on the model in ANTHROPIC_LIVE_MODEL (default
 * claude-haiku-5-5). Run:
 *   ANTHROPIC_LIVE_API_KEY=sk-ant-... npx jest anthropic.live
 */
const KEY = process.env.ANTHROPIC_LIVE_API_KEY ?? '';
const MODEL = process.env.ANTHROPIC_LIVE_MODEL ?? 'claude-haiku-5-5';
const live = KEY ? describe : describe.skip;

jest.setTimeout(120_000);

live('AnthropicProvider live', () => {
  const provider = new AnthropicProvider();
  const settings = { api_key: KEY, base_url: 'https://api.anthropic.com' };

  it('connects and lists models', async () => {
    expect(await provider.checkConnectivity(settings)).toEqual({ ok: true, detail: null });
    const models = await provider.listModels(settings);
    console.log('live models:', models.join(', '));
    expect(models).toContain(MODEL);
  });

  it('streams a short completion with usage', async () => {
    const deltas: string[] = [];
    const completion = await provider.streamCompletion(
      settings,
      MODEL,
      {
        messages: [
          textMessage('system', 'Answer in one word.'),
          textMessage('user', 'What colour is the sky on a clear day?'),
        ],
      },
      (e) => {
        if (e.type === 'text_delta') deltas.push(e.delta);
      },
    );
    console.log(
      'live short completion:',
      JSON.stringify({ text: getCompletionText(completion), usage: completion.usage }),
    );
    expect(getCompletionText(completion).length).toBeGreaterThan(0);
    expect(deltas.join('')).toBe(getCompletionText(completion));
    expect(completion.finishReason).toBe('stop');
    expect(completion.usage?.promptTokens).toBeGreaterThan(0);
    expect(completion.usage?.completionTokens).toBeGreaterThan(0);
  });

  it('reads the prompt cache on the second request sharing a long system prompt', async () => {
    const paragraph =
      'You are a careful assistant for a test harness. Follow every instruction literally, keep answers short, ' +
      'and never add commentary. This paragraph is repeated to exceed the minimum cacheable prefix. ';
    const system = Array.from({ length: 40 }, (_, i) => `${i + 1}. ${paragraph}`).join('\n');
    const ask = (q: string) =>
      provider.streamCompletion(
        settings,
        MODEL,
        { messages: [textMessage('system', system), textMessage('user', q)] },
        () => {},
      );
    const first = await ask('Reply with the single word: one');
    const second = await ask('Reply with the single word: two');
    console.log('live cache usage:', JSON.stringify({ first: first.usage, second: second.usage }));
    expect(first.usage?.promptTokens).toBeGreaterThan(1000);
    expect(second.usage?.cachedPromptTokens).toBeGreaterThan(0);
  });

  it('accepts text-rendered tool history when no tools are defined', async () => {
    const messages: LlmMessage[] = [
      textMessage('system', 'Answer briefly.'),
      textMessage('user', 'What time is it in UTC?'),
      { role: 'assistant', parts: [{ kind: 'tool_call', callId: 'c1', toolName: 'clock', args: { tz: 'UTC' } }] },
      { role: 'tool', parts: [{ kind: 'tool_result', callId: 'c1', ok: true, payload: '2026-10-17T12:34:00Z' }] },
      textMessage('user', 'So what time did the tool say? Just the time.'),
    ];
    const completion = await provider.streamCompletion(settings, MODEL, { messages }, () => {});
    console.log('live text-tool history:', getCompletionText(completion));
    expect(getCompletionText(completion)).toMatch(/12:34/);
  });

  it('round-trips a native tool call and its result', async () => {
    const tools = [
      {
        name: 'get_time',
        description: 'Returns the current time in the given IANA time zone.',
        paramsSchema: { type: 'object', properties: { tz: { type: 'string' } }, required: ['tz'] },
      },
    ];
    const first = await provider.streamCompletion(
      settings,
      MODEL,
      {
        messages: [textMessage('user', 'What time is it in UTC right now? Use the get_time tool.')],
        tools,
        toolChoice: 'auto',
      },
      () => {},
    );
    const calls = getCompletionToolCalls(first);
    console.log('live native tool call:', JSON.stringify({ parts: first.parts, finish: first.finishReason }));
    expect(first.finishReason).toBe('tool_calls');
    expect(calls).toHaveLength(1);
    expect(calls[0].toolName).toBe('get_time');
    expect((calls[0].args as { tz?: string }).tz).toBeTruthy();

    const second = await provider.streamCompletion(
      settings,
      MODEL,
      {
        messages: [
          textMessage('user', 'What time is it in UTC right now? Use the get_time tool.'),
          { role: 'assistant', parts: first.parts.filter((p) => p.kind !== 'thinking') },
          { role: 'tool', parts: [{ kind: 'tool_result', callId: calls[0].callId, ok: true, payload: '09:15 UTC' }] },
        ],
        tools,
      },
      () => {},
    );
    console.log('live native tool result turn:', getCompletionText(second));
    expect(getCompletionText(second)).toMatch(/9:15/);
  });

  it('honours a json_schema response format', async () => {
    const completion = await provider.streamCompletion(
      settings,
      MODEL,
      {
        messages: [textMessage('user', 'Name the capital of France.')],
        responseFormat: {
          type: 'json_schema',
          name: 'answer',
          schema: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
            additionalProperties: false,
          },
        },
      },
      () => {},
    );
    const text = getCompletionText(completion);
    console.log('live json_schema:', text);
    expect((JSON.parse(text) as { city: string }).city).toMatch(/Paris/);
  });
});
