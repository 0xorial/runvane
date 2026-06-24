import {
  buildOpenRouterBody,
  describeFetchCause,
  isAnthropicOpenRouterModel,
  parseChatCompletionsUsage,
  withAnthropicCacheBreakpoints,
} from './openAiShared.js';
import type { LlmRequest } from '../types.js';

describe('describeFetchCause', () => {
  it('unwraps undici cause code + message from a "fetch failed" TypeError', () => {
    const err = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1234'), { code: 'ECONNREFUSED' }),
    });
    expect(describeFetchCause(err)).toBe('ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:1234');
  });

  it('falls back to the cause code alone', () => {
    const err = new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    expect(describeFetchCause(err)).toBe('ENOTFOUND');
  });

  it('falls back to the error message when there is no cause', () => {
    expect(describeFetchCause(new Error('boom'))).toBe('boom');
  });
});

describe('parseChatCompletionsUsage', () => {
  it('reads OpenRouter prompt_tokens_details.cached_tokens', () => {
    expect(
      parseChatCompletionsUsage({
        prompt_tokens: 10_339,
        completion_tokens: 60,
        prompt_tokens_details: { cached_tokens: 10_318, cache_write_tokens: 0 },
      }),
    ).toEqual({
      promptTokens: 10_339,
      completionTokens: 60,
      cachedPromptTokens: 10_318,
    });
  });

  it('reads OpenRouter usage.cost', () => {
    expect(
      parseChatCompletionsUsage({
        prompt_tokens: 100,
        completion_tokens: 20,
        cost: 0.0042,
      }),
    ).toEqual({
      promptTokens: 100,
      completionTokens: 20,
      costUsd: 0.0042,
    });
  });

  it('reads Anthropic-native cache_read_input_tokens', () => {
    expect(
      parseChatCompletionsUsage({
        input_tokens: 500,
        output_tokens: 42,
        cache_read_input_tokens: 400,
      }),
    ).toEqual({
      promptTokens: 500,
      completionTokens: 42,
      cachedPromptTokens: 400,
    });
  });
});

describe('withAnthropicCacheBreakpoints', () => {
  it('breakpoints system and the turn before the latest user message', () => {
    const out = withAnthropicCacheBreakpoints([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ]);
    expect(out[0].content).toEqual([{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }]);
    expect(out[2].content).toEqual([{ type: 'text', text: 'reply', cache_control: { type: 'ephemeral' } }]);
    expect(out[3].content).toBe('second');
  });
});

describe('buildOpenRouterBody', () => {
  const request: LlmRequest = { messages: [{ role: 'user', parts: [{ kind: 'text', text: 'hi' }] }] };

  it('enables automatic Anthropic caching on OpenRouter', () => {
    const body = buildOpenRouterBody('anthropic/claude-sonnet-4', request);
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.provider).toEqual({ only: ['anthropic'] });
  });

  it('does not override explicit cache_control', () => {
    const body = buildOpenRouterBody('anthropic/claude-sonnet-4', {
      ...request,
      requestParams: { cache_control: { type: 'ephemeral', ttl: '1h' } },
    });
    expect(body.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('skips cache_control for non-Anthropic models', () => {
    const body = buildOpenRouterBody('openai/gpt-4o', request);
    expect(body.cache_control).toBeUndefined();
  });
});

describe('isAnthropicOpenRouterModel', () => {
  it('matches anthropic slugs', () => {
    expect(isAnthropicOpenRouterModel('anthropic/claude-sonnet-4')).toBe(true);
    expect(isAnthropicOpenRouterModel('~anthropic/claude-sonnet-latest')).toBe(true);
    expect(isAnthropicOpenRouterModel('openai/gpt-4o')).toBe(false);
  });
});
