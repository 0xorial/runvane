import { APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import type {
  MessageCreateParamsStreaming,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages/messages.js';
import { StreamInterruptedError, type ProviderSettingsDict } from '../provider.js';
import { getCompletionText, textMessage, type LlmStreamEvent } from '../types.js';
import { AnthropicProvider, normalizeAnthropicBaseUrl, type AnthropicClientLike } from './anthropic.js';

const SETTINGS: ProviderSettingsDict = { api_key: 'sk-ant-test', base_url: 'https://api.anthropic.com' };

const HELLO_EVENTS: RawMessageStreamEvent[] = [
  {
    type: 'message_start',
    message: {
      id: 'msg_1',
      usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 },
    } as never,
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: null } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
  { type: 'content_block_stop', index: 0 },
  {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null } as never,
    usage: { output_tokens: 3 } as never,
  },
  { type: 'message_stop' },
];

type FakeSpec = {
  events?: RawMessageStreamEvent[];
  createError?: Error;
  /** Called between the first and second event, e.g. to abort the signal. */
  afterFirstEvent?: () => void;
  models?: Array<{ id: string; lifecycle?: string }>;
  listError?: Error;
};

async function* streamOf(
  spec: FakeSpec,
  signal: AbortSignal | null | undefined,
): AsyncGenerator<RawMessageStreamEvent> {
  const events = spec.events ?? [];
  for (let i = 0; i < events.length; i++) {
    await Promise.resolve();
    if (i === 1) {
      spec.afterFirstEvent?.();
      if (signal?.aborted) throw new APIUserAbortError();
    }
    yield events[i];
  }
}

async function* modelsOf(spec: FakeSpec): AsyncGenerator<{ id: string; lifecycle?: string }> {
  await Promise.resolve();
  if (spec.listError) throw spec.listError;
  for (const m of spec.models ?? []) yield m;
}

class FakeProvider extends AnthropicProvider {
  calls: Array<{ body: MessageCreateParamsStreaming; signal: AbortSignal | null | undefined }> = [];
  constructor(private readonly spec: FakeSpec) {
    super();
  }
  protected override createClient(): AnthropicClientLike {
    const spec = this.spec;
    const calls = this.calls;
    return {
      messages: {
        create(body, options) {
          calls.push({ body, signal: options?.signal });
          if (spec.createError) return Promise.reject(spec.createError);
          return Promise.resolve(streamOf(spec, options?.signal));
        },
      },
      models: {
        list() {
          return modelsOf(spec);
        },
      },
    };
  }
}

function apiError(status: number, message: string): APIError {
  return new APIError(status, { type: 'error', error: { type: 'invalid_request_error', message } }, message, undefined);
}

describe('normalizeAnthropicBaseUrl', () => {
  it('defaults when empty and strips a pasted /v1 and trailing slashes', () => {
    expect(normalizeAnthropicBaseUrl('')).toBe('https://api.anthropic.com');
    expect(normalizeAnthropicBaseUrl(undefined)).toBe('https://api.anthropic.com');
    expect(normalizeAnthropicBaseUrl('https://api.anthropic.com/v1/')).toBe('https://api.anthropic.com');
    expect(normalizeAnthropicBaseUrl('https://proxy.test/anthropic/')).toBe('https://proxy.test/anthropic');
  });
});

describe('AnthropicProvider.streamCompletion', () => {
  it('streams a completion and forwards the abort signal', async () => {
    const provider = new FakeProvider({ events: HELLO_EVENTS });
    const seen: LlmStreamEvent[] = [];
    const controller = new AbortController();
    const completion = await provider.streamCompletion(
      SETTINGS,
      'claude-opus-5-5',
      { messages: [textMessage('system', 'be brief'), textMessage('user', 'hello')] },
      (e) => seen.push(e),
      controller.signal,
    );
    expect(getCompletionText(completion)).toBe('Hi');
    expect(completion.finishReason).toBe('stop');
    expect(completion.usage).toEqual({ promptTokens: 10, completionTokens: 3, cachedPromptTokens: 0 });
    expect(completion.rawChunks).toEqual(HELLO_EVENTS);
    expect(seen.some((e) => e.type === 'text_delta')).toBe(true);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].signal).toBe(controller.signal);
    expect(provider.calls[0].body.model).toBe('claude-opus-5-5');
    expect(provider.calls[0].body.system).toEqual([
      { type: 'text', text: 'be brief', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('refuses without an API key before touching the network', async () => {
    const provider = new FakeProvider({ events: HELLO_EVENTS });
    await expect(
      provider.streamCompletion({}, 'm', { messages: [textMessage('user', 'x')] }, () => {}),
    ).rejects.toThrow('api_key is required');
    expect(provider.calls).toHaveLength(0);
  });

  it('surfaces API errors with status and message (e.g. an exhausted credit balance)', async () => {
    const provider = new FakeProvider({
      createError: apiError(400, 'Your credit balance is too low to access the Anthropic API.'),
    });
    await expect(
      provider.streamCompletion(SETTINGS, 'm', { messages: [textMessage('user', 'x')] }, () => {}),
    ).rejects.toThrow('llm request failed (400): Your credit balance is too low to access the Anthropic API.');
  });

  it('turns an abort mid-stream into StreamInterruptedError with the partial text', async () => {
    const controller = new AbortController();
    const events: RawMessageStreamEvent[] = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'partial', citations: null } },
      HELLO_EVENTS[2],
    ];
    const provider = new FakeProvider({ events, afterFirstEvent: () => controller.abort() });
    const err = await provider
      .streamCompletion(SETTINGS, 'm', { messages: [textMessage('user', 'x')] }, () => {}, controller.signal)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StreamInterruptedError);
    expect((err as StreamInterruptedError).message).toBe('stream aborted');
    expect((err as StreamInterruptedError).partialText).toBe('partial');
  });

  it('wraps a throwing event callback as a stream interruption', async () => {
    const provider = new FakeProvider({ events: HELLO_EVENTS });
    const err = await provider
      .streamCompletion(SETTINGS, 'm', { messages: [textMessage('user', 'x')] }, () => {
        throw new Error('consumer broke');
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StreamInterruptedError);
    expect((err as StreamInterruptedError).message).toBe('stream interrupted during callback');
  });
});

describe('AnthropicProvider connectivity and models', () => {
  it('reports a missing key without a request', async () => {
    const provider = new FakeProvider({});
    expect(await provider.checkConnectivity({})).toEqual({ ok: false, detail: 'api_key is required' });
  });

  it('reports ok when the model list responds', async () => {
    const provider = new FakeProvider({ models: [{ id: 'claude-opus-5-5' }] });
    expect(await provider.checkConnectivity(SETTINGS)).toEqual({ ok: true, detail: null });
  });

  it('reports the status and message of a rejected key', async () => {
    const provider = new FakeProvider({ listError: apiError(401, 'invalid x-api-key') });
    expect(await provider.checkConnectivity(SETTINGS)).toEqual({
      ok: false,
      detail: 'connectivity failed (401): invalid x-api-key',
    });
  });

  it('lists live models, dropping retired ids and duplicates', async () => {
    const provider = new FakeProvider({
      models: [
        { id: 'claude-opus-5-5', lifecycle: 'active' },
        { id: 'claude-sonnet-4-6', lifecycle: 'deprecated' },
        { id: 'claude-3-opus', lifecycle: 'retired' },
        { id: 'claude-opus-5-5', lifecycle: 'active' },
      ],
    });
    expect(await provider.listModels(SETTINGS)).toEqual(['claude-opus-5-5', 'claude-sonnet-4-6']);
  });
});
