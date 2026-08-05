import { Injectable, Logger } from '@nestjs/common';
import type {
  ConnectivityResult,
  LlmProvider,
  LlmProviderSettingSpec,
  ProviderSettingsDict,
} from '../provider.js';
import { StreamInterruptedError, isAbortError } from '../provider.js';
import type { LlmCompletion, LlmOutputPart, LlmRequest, LlmStreamEvent, LlmUsage } from '../types.js';
import {
  CLAUDE_SUBSCRIPTION_FALLBACK_MODELS,
  buildSdkEnv,
  mapSdkUsage,
  renderSdkPrompt,
  type AgentSdkQueryFn,
} from './claudeSubscriptionShared.js';

/**
 * Claude-plan provider: runs every completion through the Claude Agent SDK
 * (which spawns its pinned Claude Code CLI), so usage draws from the user's
 * Claude subscription instead of pay-as-you-go API billing — the officially
 * supported path for third-party apps on a Claude plan.
 *
 * Each planner call is one stateless `query()`: custom system prompt, all
 * built-in tools disabled, `maxTurns: 1`, no session persistence. The
 * conversation rides in as a single user message (see
 * claudeSubscriptionShared.ts); tool calls flow through runvane's normal
 * text-dialect parsing.
 */

const CONNECTIVITY_TIMEOUT_MS = 90_000;
const LIST_MODELS_TIMEOUT_MS = 30_000;

type SdkMessageView = {
  type?: unknown;
  subtype?: unknown;
  is_error?: unknown;
  result?: unknown;
  errors?: unknown;
  usage?: unknown;
  structured_output?: unknown;
  model?: unknown;
  claude_code_version?: unknown;
  event?: { type?: unknown; delta?: { type?: unknown; text?: unknown; thinking?: unknown } };
  message?: { content?: unknown };
};

function asView(raw: unknown): SdkMessageView {
  return raw && typeof raw === 'object' ? (raw as SdkMessageView) : {};
}

function resultErrorDetail(view: SdkMessageView): string {
  const fromResult = typeof view.result === 'string' ? view.result.trim() : '';
  const fromErrors = Array.isArray(view.errors)
    ? view.errors.filter((e): e is string => typeof e === 'string').join('; ')
    : '';
  const detail = fromResult || fromErrors || `run failed (${String(view.subtype ?? 'unknown')})`;
  return /not logged in|invalid api key|please run \/login/i.test(detail)
    ? `${detail} — run \`claude setup-token\` on a logged-in machine and paste the token into this provider's settings`
    : detail;
}

@Injectable()
export class ClaudeSubscriptionProvider implements LlmProvider {
  readonly id = 'claude-subscription';
  readonly label = 'Claude subscription (Agent SDK)';
  private readonly logger = new Logger(ClaudeSubscriptionProvider.name);

  getSettingsSpec(): LlmProviderSettingSpec[] {
    return [
      {
        key: 'oauth_token',
        label: 'OAuth token (claude setup-token)',
        type: 'secret',
        required: false,
        placeholder: "sk-ant-oat01-… — leave empty to use this machine's claude login",
      },
    ];
  }

  /** Seam for tests. The Agent SDK is ESM-only; under module:nodenext this
   *  dynamic `import()` is emitted verbatim, which CJS Node loads fine. */
  protected async loadQuery(): Promise<AgentSdkQueryFn> {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    return sdk.query as unknown as AgentSdkQueryFn;
  }

  private oauthToken(settings: ProviderSettingsDict): string | undefined {
    const token = String(settings.oauth_token ?? '').trim();
    return token.length > 0 ? token : undefined;
  }

  private baseOptions(settings: ProviderSettingsDict): Record<string, unknown> {
    return {
      tools: [],
      maxTurns: 1,
      settingSources: [],
      persistSession: false,
      env: buildSdkEnv(process.env, this.oauthToken(settings)),
    };
  }

  async checkConnectivity(settings: ProviderSettingsDict): Promise<ConnectivityResult> {
    try {
      const queryFn = await this.loadQuery();
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), CONNECTIVITY_TIMEOUT_MS);
      try {
        const q = queryFn({
          prompt: 'Reply with the single word: OK',
          options: {
            ...this.baseOptions(settings),
            systemPrompt: 'You are a connectivity probe. Reply with the single word: OK.',
            model: 'haiku',
            abortController: abort,
          },
        });
        let cliInfo = '';
        for await (const raw of q) {
          const view = asView(raw);
          if (view.type === 'system' && view.subtype === 'init') {
            cliInfo = `Claude Code ${String(view.claude_code_version ?? '?')}`;
          } else if (view.type === 'result') {
            if (view.is_error) return { ok: false, detail: resultErrorDetail(view) };
            return { ok: true, detail: `${cliInfo || 'ok'} — authenticated via Claude plan` };
          }
        }
        return { ok: false, detail: 'Claude Code run produced no result' };
      } finally {
        clearTimeout(timer);
        abort.abort();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, detail: `connectivity failed: ${msg.slice(0, 300)}` };
    }
  }

  async listModels(settings: ProviderSettingsDict): Promise<string[]> {
    try {
      const queryFn = await this.loadQuery();
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), LIST_MODELS_TIMEOUT_MS);
      // Streaming-input query that never sends a turn: it exists only so the
      // `supportedModels` control request has a live CLI process to talk to.
      const idle = async function* (signal: AbortSignal): AsyncIterable<unknown> {
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
      };
      const q = queryFn({
        prompt: idle(abort.signal),
        options: { ...this.baseOptions(settings), abortController: abort },
      });
      const consumed = (async () => {
        try {
          for await (const _ of q) void _;
        } catch {
          /* interrupted on purpose */
        }
      })();
      try {
        if (typeof q.supportedModels !== 'function') throw new Error('supportedModels unavailable');
        const models = await q.supportedModels();
        const names = models
          .map((m) => (typeof m?.value === 'string' ? m.value.trim() : ''))
          .filter((v) => v.length > 0);
        if (names.length === 0) throw new Error('empty model list');
        return Array.from(new Set(names));
      } finally {
        clearTimeout(timer);
        abort.abort();
        await consumed;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`model discovery failed (${msg.slice(0, 200)}); using fallback list`);
      return [...CLAUDE_SUBSCRIPTION_FALLBACK_MODELS];
    }
  }

  async streamCompletion(
    settings: ProviderSettingsDict,
    model: string,
    request: LlmRequest,
    onEvent: (event: LlmStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<LlmCompletion> {
    const queryFn = await this.loadQuery();
    const rendered = renderSdkPrompt(request);

    const abort = new AbortController();
    if (signal?.aborted) abort.abort();
    else signal?.addEventListener('abort', () => abort.abort(), { once: true });

    const options: Record<string, unknown> = {
      ...this.baseOptions(settings),
      model,
      includePartialMessages: true,
      abortController: abort,
      ...(rendered.systemPrompt !== undefined ? { systemPrompt: rendered.systemPrompt } : {}),
      ...(request.responseFormat?.type === 'json_schema'
        ? { outputFormat: { type: 'json_schema', schema: request.responseFormat.schema } }
        : {}),
    };
    this.logger.log(
      { providerId: this.id, model, turns: request.messages.length, blocks: rendered.blocks.length },
      '[llm-provider] completion request sending',
    );

    const transcriptMessage = {
      type: 'user',
      message: { role: 'user', content: rendered.blocks },
      parent_tool_use_id: null,
      session_id: '',
    };
    // Single-yield streaming input: content blocks (images/documents) need the
    // structured form, and the closed stream ends the run after one turn.
    const promptStream = async function* (): AsyncIterable<unknown> {
      yield transcriptMessage;
    };

    const parts: LlmOutputPart[] = [];
    const rawChunks: unknown[] = [];
    let partialText = '';
    let usage: LlmUsage | undefined;
    let structuredOutput: unknown;
    let sawResult = false;

    try {
      const q = queryFn({ prompt: promptStream(), options });
      for await (const raw of q) {
        rawChunks.push(raw);
        const view = asView(raw);
        if (view.type === 'stream_event') {
          const delta = view.event?.type === 'content_block_delta' ? view.event.delta : undefined;
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            partialText += delta.text;
            onEvent({ type: 'text_delta', delta: delta.text });
          } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
            onEvent({ type: 'thinking_delta', delta: delta.thinking });
          }
        } else if (view.type === 'assistant') {
          const content = Array.isArray(view.message?.content) ? view.message.content : [];
          for (const rawBlock of content) {
            const block = asView(rawBlock) as Record<string, unknown>;
            if (block.type === 'text' && typeof block.text === 'string') {
              parts.push({ kind: 'text', text: block.text });
            } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
              parts.push({ kind: 'thinking', text: block.thinking });
            } else if (block.type === 'tool_use') {
              // Cannot happen with `tools: []`, but map faithfully if it does.
              parts.push({
                kind: 'tool_call',
                callId: String(block.id ?? ''),
                toolName: String(block.name ?? ''),
                args: block.input,
              });
            }
          }
        } else if (view.type === 'result') {
          sawResult = true;
          usage = mapSdkUsage(view.usage);
          if (usage) onEvent({ type: 'usage', usage });
          if (view.is_error) throw new Error(`claude subscription request failed: ${resultErrorDetail(view)}`);
          structuredOutput = view.structured_output;
          break;
        }
      }
    } catch (error) {
      if (error instanceof StreamInterruptedError) throw error;
      if (isAbortError(error) || signal?.aborted) {
        throw new StreamInterruptedError({
          message: 'stream aborted',
          partialText,
          ...(usage ? { usage } : {}),
          cause: error,
        });
      }
      throw error;
    } finally {
      // Stop the CLI subprocess if we broke out early (or a callback threw).
      abort.abort();
    }

    if (!sawResult && signal?.aborted) {
      throw new StreamInterruptedError({
        message: 'stream aborted',
        partialText,
        ...(usage ? { usage } : {}),
      });
    }
    // Structured-output runs may report the parsed object only on the result.
    if (!parts.some((p) => p.kind === 'text') && structuredOutput !== undefined) {
      parts.push({ kind: 'text', text: JSON.stringify(structuredOutput) });
    }
    if (parts.length === 0) {
      // Same contract as the other adapters: empty completion is a valid no-op.
      this.logger.warn('llm returned empty completion — finalizing as no-op');
    }
    onEvent({ type: 'finish', reason: 'stop' });
    return { parts, finishReason: 'stop', ...(usage ? { usage } : {}), rawChunks };
  }
}
