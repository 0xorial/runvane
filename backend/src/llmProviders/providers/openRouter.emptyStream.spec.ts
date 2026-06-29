import { OpenRouterProvider } from './openRouter.js';
import type { LlmRequest, LlmStreamEvent } from '../types.js';

/**
 * Regression: an empty completion (model streams a clean end-of-turn with no
 * text/thinking/tool calls — e.g. Anthropic `end_turn` with zero content) must
 * NOT throw. It is a valid, if unhelpful, outcome; callers finalize gracefully.
 */
describe('OpenRouterProvider empty stream', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function mockSse(lines: string[]): void {
    async function* body(): AsyncGenerator<Uint8Array> {
      const enc = new TextEncoder();
      for (const line of lines) yield enc.encode(line);
    }
    global.fetch = (async () =>
      ({ ok: true, status: 200, body: body() }) as unknown as Response) as typeof fetch;
  }

  const settings = { api_key: 'k', base_url: 'https://example.test/v1' };
  const request: LlmRequest = { messages: [{ role: 'user', parts: [{ kind: 'text', text: 'hi' }] }] };

  it('returns an empty completion instead of throwing on a content-less stream', async () => {
    // A finish chunk with no delta content, then [DONE] — nothing reaches the
    // accumulator, so hasContent() is false.
    mockSse(['data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n']);
    const events: LlmStreamEvent[] = [];
    const completion = await new OpenRouterProvider().streamCompletion(
      settings,
      'anthropic/claude-opus-4.7',
      request,
      (e) => events.push(e),
    );
    expect(completion.parts).toEqual([]);
    expect(completion.finishReason).toBe('stop');
  });
});
