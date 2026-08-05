import { ClaudeSubscriptionProvider } from './claudeSubscription.js';
import {
  CLAUDE_SUBSCRIPTION_FALLBACK_MODELS,
  buildSdkEnv,
  mapSdkUsage,
  renderSdkPrompt,
  type AgentSdkQueryFn,
  type AgentSdkQueryHandle,
  type SdkContentBlock,
} from './claudeSubscriptionShared.js';
import { StreamInterruptedError } from '../provider.js';
import type { LlmRequest, LlmStreamEvent } from '../types.js';

function textBlocks(blocks: SdkContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<SdkContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n<<<block>>>\n');
}

describe('renderSdkPrompt', () => {
  it('extracts the leading system message and labels the transcript turns', () => {
    const request: LlmRequest = {
      messages: [
        { role: 'system', parts: [{ kind: 'text', text: 'You are the planner.' }] },
        { role: 'user', parts: [{ kind: 'text', text: 'hello there' }] },
        { role: 'assistant', parts: [{ kind: 'text', text: 'hi!' }] },
        { role: 'system', parts: [{ kind: 'text', text: 'tools changed' }] },
        { role: 'user', parts: [{ kind: 'text', text: 'and now?' }] },
      ],
    };
    const rendered = renderSdkPrompt(request);
    expect(rendered.systemPrompt).toBe('You are the planner.');
    expect(rendered.blocks).toHaveLength(1);
    const text = textBlocks(rendered.blocks);
    expect(text).toContain('[User]\nhello there');
    expect(text).toContain('[Assistant]\nhi!');
    expect(text).toContain('[System note]\ntools changed');
    expect(text).toContain('[Reply now as the assistant]');
    // The mid-conversation system note must NOT be hoisted into systemPrompt.
    expect(rendered.systemPrompt).not.toContain('tools changed');
  });

  it('renders tool call/result pairs as labeled text', () => {
    const request: LlmRequest = {
      messages: [
        { role: 'user', parts: [{ kind: 'text', text: 'read the file' }] },
        {
          role: 'assistant',
          parts: [{ kind: 'tool_call', callId: 'c1', toolName: 'filesystem', args: { path: '/a.txt' } }],
        },
        { role: 'tool', parts: [{ kind: 'tool_result', callId: 'c1', ok: true, payload: 'contents!' }] },
      ],
    };
    const text = textBlocks(renderSdkPrompt(request).blocks);
    expect(text).toContain('[Assistant tool call c1 → filesystem]\narguments: {"path":"/a.txt"}');
    expect(text).toContain('[Tool result for call c1 — ok]\ncontents!');
  });

  it('interleaves image blocks at their transcript position', () => {
    const request: LlmRequest = {
      messages: [
        {
          role: 'user',
          parts: [
            { kind: 'text', text: 'look at this' },
            { kind: 'image', mime: 'image/png', data: { base64: 'AAAA' } },
            { kind: 'text', text: 'what is it?' },
          ],
        },
      ],
    };
    const { blocks } = renderSdkPrompt(request);
    expect(blocks.map((b) => b.type)).toEqual(['text', 'image', 'text']);
    expect(blocks[0]).toMatchObject({ text: expect.stringContaining('[User]\nlook at this') });
    expect(blocks[1]).toMatchObject({ source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
    expect(blocks[2]).toMatchObject({ text: expect.stringContaining('what is it?') });
  });

  it('maps pdf files to document blocks and inlines text files', () => {
    const request: LlmRequest = {
      messages: [
        {
          role: 'user',
          parts: [
            { kind: 'file', filename: 'doc.pdf', mime: 'application/pdf', base64: 'UERG' },
            {
              kind: 'file',
              filename: 'notes.txt',
              mime: 'text/plain',
              base64: Buffer.from('plain text body').toString('base64'),
            },
          ],
        },
      ],
    };
    const { blocks } = renderSdkPrompt(request);
    const doc = blocks.find((b) => b.type === 'document');
    expect(doc).toMatchObject({ title: 'doc.pdf', source: { media_type: 'application/pdf', data: 'UERG' } });
    expect(textBlocks(blocks)).toContain('[Attached file "notes.txt" (text/plain)]\nplain text body');
  });
});

describe('buildSdkEnv', () => {
  it('strips ambient API keys and injects the oauth token', () => {
    const env = buildSdkEnv(
      { PATH: '/bin', ANTHROPIC_API_KEY: 'sk-ant-pay-as-you-go', ANTHROPIC_AUTH_TOKEN: 'x' },
      'sk-ant-oat01-abc',
    );
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-abc');
    expect(env.PATH).toBe('/bin');
  });

  it('leaves the token unset so the CLI login is used when none is configured', () => {
    const env = buildSdkEnv({ PATH: '/bin' }, undefined);
    expect('CLAUDE_CODE_OAUTH_TOKEN' in env).toBe(false);
  });
});

describe('mapSdkUsage', () => {
  it('folds cache reads/creations into promptTokens and reports the cached share', () => {
    expect(
      mapSdkUsage({
        input_tokens: 10,
        cache_read_input_tokens: 90,
        cache_creation_input_tokens: 20,
        output_tokens: 5,
      }),
    ).toEqual({ promptTokens: 120, completionTokens: 5, cachedPromptTokens: 90 });
  });

  it('returns undefined for empty or malformed usage', () => {
    expect(mapSdkUsage(null)).toBeUndefined();
    expect(mapSdkUsage({ input_tokens: 0, output_tokens: 0 })).toBeUndefined();
  });
});

type FakeRun = {
  messages: unknown[];
  /** Optional hook run between yielded messages, keyed by index. */
  throwAfter?: number;
  error?: unknown;
};

class TestableProvider extends ClaudeSubscriptionProvider {
  captured: Array<{ prompt: unknown; options: Record<string, unknown> | undefined }> = [];
  constructor(private readonly run: FakeRun) {
    super();
  }
  protected override loadQuery(): Promise<AgentSdkQueryFn> {
    const { run, captured } = { run: this.run, captured: this.captured };
    const fn: AgentSdkQueryFn = ({ prompt, options }) => {
      captured.push({ prompt, options });
      const iterable: AgentSdkQueryHandle = {
        async *[Symbol.asyncIterator]() {
          for (let i = 0; i < run.messages.length; i += 1) {
            if (run.throwAfter === i) throw run.error;
            yield run.messages[i];
          }
          if (run.throwAfter === run.messages.length) throw run.error;
        },
      };
      return iterable;
    };
    return Promise.resolve(fn);
  }
}

const initMessage = {
  type: 'system',
  subtype: 'init',
  model: 'claude-sonnet-5',
  claude_code_version: '2.1.222',
  apiKeySource: 'oauth',
};

function delta(type: 'text_delta' | 'thinking_delta', value: string): unknown {
  const payload = type === 'text_delta' ? { type, text: value } : { type, thinking: value };
  return { type: 'stream_event', event: { type: 'content_block_delta', delta: payload } };
}

const successResult = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Hello!',
  usage: { input_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: 0, output_tokens: 4 },
  total_cost_usd: 0,
};

const simpleRequest: LlmRequest = {
  messages: [
    { role: 'system', parts: [{ kind: 'text', text: 'sys' }] },
    { role: 'user', parts: [{ kind: 'text', text: 'hi' }] },
  ],
};

describe('ClaudeSubscriptionProvider.streamCompletion', () => {
  it('streams deltas, assembles parts from the assistant message, and maps usage', async () => {
    const provider = new TestableProvider({
      messages: [
        initMessage,
        delta('thinking_delta', 'hmm'),
        delta('text_delta', 'Hel'),
        delta('text_delta', 'lo!'),
        {
          type: 'assistant',
          message: { content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Hello!' }] },
        },
        successResult,
      ],
    });
    const events: LlmStreamEvent[] = [];
    const completion = await provider.streamCompletion(
      { oauth_token: 'sk-ant-oat01-t' },
      'claude-sonnet-5',
      simpleRequest,
      (e) => events.push(e),
    );

    expect(completion.parts).toEqual([
      { kind: 'thinking', text: 'hmm' },
      { kind: 'text', text: 'Hello!' },
    ]);
    expect(completion.finishReason).toBe('stop');
    expect(completion.usage).toEqual({ promptTokens: 10, completionTokens: 4, cachedPromptTokens: 3 });
    expect(completion.rawChunks?.length).toBe(6);
    expect(events.map((e) => e.type)).toEqual([
      'thinking_delta',
      'text_delta',
      'text_delta',
      'usage',
      'finish',
    ]);

    const { options } = provider.captured[0];
    expect(options?.model).toBe('claude-sonnet-5');
    expect(options?.tools).toEqual([]);
    expect(options?.maxTurns).toBe(1);
    expect(options?.systemPrompt).toBe('sys');
    expect(options?.persistSession).toBe(false);
    const env = options?.env as Record<string, string | undefined>;
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-t');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('throws an actionable error on an is_error result, with the setup-token hint', async () => {
    const provider = new TestableProvider({
      messages: [
        initMessage,
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Not logged in · Please run /login' }] },
        },
        {
          type: 'result',
          subtype: 'success',
          is_error: true,
          result: 'Not logged in · Please run /login',
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      ],
    });
    await expect(
      provider.streamCompletion({}, 'sonnet', simpleRequest, () => {}),
    ).rejects.toThrow(/Not logged in.*claude setup-token/s);
  });

  it('wraps an abort in StreamInterruptedError carrying the partial text', async () => {
    const abortError = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    const provider = new TestableProvider({
      messages: [initMessage, delta('text_delta', 'Hel')],
      throwAfter: 2,
      error: abortError,
    });
    const err = await provider
      .streamCompletion({}, 'sonnet', simpleRequest, () => {})
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StreamInterruptedError);
    expect((err as StreamInterruptedError).partialText).toBe('Hel');
  });

  it('resolves an empty completion instead of throwing', async () => {
    const provider = new TestableProvider({
      messages: [initMessage, { ...successResult, result: '' }],
    });
    const completion = await provider.streamCompletion({}, 'sonnet', simpleRequest, () => {});
    expect(completion.parts).toEqual([]);
    expect(completion.finishReason).toBe('stop');
  });

  it('passes json_schema responseFormat through as outputFormat and falls back to structured_output', async () => {
    const provider = new TestableProvider({
      messages: [
        initMessage,
        { ...successResult, structured_output: { a: 1 } },
      ],
    });
    const request: LlmRequest = {
      ...simpleRequest,
      responseFormat: { type: 'json_schema', name: 'args', schema: { type: 'object' } },
    };
    const completion = await provider.streamCompletion({}, 'sonnet', request, () => {});
    expect(provider.captured[0].options?.outputFormat).toEqual({
      type: 'json_schema',
      schema: { type: 'object' },
    });
    expect(completion.parts).toEqual([{ kind: 'text', text: '{"a":1}' }]);
  });
});

describe('ClaudeSubscriptionProvider.checkConnectivity / listModels', () => {
  it('reports ok on a successful probe and failure detail on error results', async () => {
    const ok = new TestableProvider({ messages: [initMessage, { ...successResult, result: 'OK' }] });
    await expect(ok.checkConnectivity({})).resolves.toEqual({
      ok: true,
      detail: 'Claude Code 2.1.222 — authenticated via Claude plan',
    });

    const bad = new TestableProvider({
      messages: [
        initMessage,
        { type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' },
      ],
    });
    const res = await bad.checkConnectivity({});
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/claude setup-token/);
  });

  it('falls back to the static model list when discovery is unavailable', async () => {
    const provider = new TestableProvider({ messages: [] });
    await expect(provider.listModels({})).resolves.toEqual(CLAUDE_SUBSCRIPTION_FALLBACK_MODELS);
  });
});
