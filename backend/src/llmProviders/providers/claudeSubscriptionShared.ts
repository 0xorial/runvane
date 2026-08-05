import type { LlmMessage, LlmRequest, LlmUsage } from '../types.js';

/**
 * Pure translation helpers for the Claude-subscription provider.
 *
 * The Agent SDK is an agent harness, not a chat-completions API: it accepts
 * one system prompt plus user input, and cannot replay an arbitrary
 * assistant/tool history. So each planner call renders the canonical
 * `LlmRequest` into (a) the leading system message as the SDK `systemPrompt`
 * and (b) the rest of the conversation as ONE user message made of Anthropic
 * content blocks — a labeled text transcript with real image/document blocks
 * interleaved at their original positions. Tool calls stay text-rendered;
 * runvane's planner-dialect parsing drives execution either way.
 */

/** Minimal structural view of the Anthropic content-block params we emit. */
export type SdkTextBlock = { type: 'text'; text: string };
export type SdkImageBlock = {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string };
};
export type SdkDocumentBlock = {
  type: 'document';
  source: { type: 'base64'; media_type: string; data: string };
  title?: string;
};
export type SdkContentBlock = SdkTextBlock | SdkImageBlock | SdkDocumentBlock;

/** Minimal structural view of the SDK `query()` surface this provider consumes.
 *  Kept local (not imported from the ESM-only package) so unit tests can fake
 *  it and compile output never depends on the SDK's own type graph. */
export type AgentSdkQueryHandle = AsyncIterable<unknown> & {
  interrupt?: () => Promise<unknown>;
  supportedModels?: () => Promise<Array<{ value?: unknown }>>;
};
export type AgentSdkQueryFn = (input: {
  prompt: string | AsyncIterable<unknown>;
  options?: Record<string, unknown>;
}) => AgentSdkQueryHandle;

const TRANSCRIPT_HEADER =
  'You are continuing the conversation transcribed below. Turns are labeled [User], ' +
  '[Assistant] (that is you), and [System note]; tool activity appears as ' +
  '[Assistant tool call …] / [Tool result …] pairs. Reply now as the assistant to the ' +
  'latest turn, following the reply-format instructions from your system prompt. ' +
  'Output only your reply — never emit the turn labels themselves.';

function stringifyLoose(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function roleHeader(message: LlmMessage): string | null {
  switch (message.role) {
    case 'user':
      return '[User]';
    case 'assistant':
      return '[Assistant]';
    case 'system':
      return '[System note]';
    case 'tool':
      // Tool messages carry self-describing `[Tool result …]` parts.
      return null;
  }
}

function decodeUtf8(base64: string): string | null {
  try {
    return Buffer.from(base64, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

export type RenderedSdkPrompt = {
  /** The leading system message's text, when the request starts with one. */
  systemPrompt?: string;
  /** Content blocks of the single user message carrying the transcript. */
  blocks: SdkContentBlock[];
};

export function renderSdkPrompt(request: LlmRequest): RenderedSdkPrompt {
  let systemPrompt: string | undefined;
  let rest = request.messages;
  if (rest.length > 0 && rest[0].role === 'system') {
    systemPrompt = rest[0].parts
      .map((p) => (p.kind === 'text' ? p.text : ''))
      .filter((t) => t.length > 0)
      .join('\n\n');
    rest = rest.slice(1);
  }

  const blocks: SdkContentBlock[] = [];
  const pending: string[] = [TRANSCRIPT_HEADER];
  const flushText = (): void => {
    const joined = pending.join('\n\n').trim();
    if (joined.length > 0) blocks.push({ type: 'text', text: joined });
    pending.length = 0;
  };

  for (const message of rest) {
    const header = roleHeader(message);
    let lines: string[] = header ? [header] : [];
    const flushMessageText = (): void => {
      const body = lines.join('\n');
      if (body.trim().length > 0) pending.push(body);
      lines = [];
    };

    for (const part of message.parts) {
      switch (part.kind) {
        case 'text':
          lines.push(part.text);
          break;
        case 'thinking':
          // Prior-turn thinking is never replayed to the model.
          break;
        case 'tool_call':
          lines.push(
            `[Assistant tool call ${part.callId} → ${part.toolName}]\narguments: ${stringifyLoose(part.args)}`,
          );
          break;
        case 'tool_result':
          lines.push(
            `[Tool result for call ${part.callId} — ${part.ok ? 'ok' : 'error'}]\n${stringifyLoose(part.payload)}`,
          );
          break;
        case 'image':
          flushMessageText();
          flushText();
          blocks.push({
            type: 'image',
            source:
              'base64' in part.data
                ? { type: 'base64', media_type: part.mime, data: part.data.base64 }
                : { type: 'url', url: part.data.url },
          });
          break;
        case 'file': {
          flushMessageText();
          if (part.mime === 'application/pdf') {
            flushText();
            blocks.push({
              type: 'document',
              source: { type: 'base64', media_type: part.mime, data: part.base64 },
              title: part.filename,
            });
            break;
          }
          const text = part.mime.startsWith('text/') ? decodeUtf8(part.base64) : null;
          pending.push(
            text !== null
              ? `[Attached file "${part.filename}" (${part.mime})]\n${text}`
              : `[Attached file "${part.filename}" (${part.mime}) — binary content not shown]`,
          );
          break;
        }
        case 'attachment_ref':
          // Expanded to image/file by the reason step before any adapter runs;
          // render a visible placeholder rather than silently dropping it.
          pending.push(`[Attachment "${part.filename}" (${part.mime}) — content unavailable]`);
          break;
      }
    }
    flushMessageText();
  }

  pending.push('[Reply now as the assistant]');
  flushText();
  return { systemPrompt, blocks };
}

/**
 * Subprocess environment for the spawned Claude Code CLI. Ambient API keys are
 * stripped unconditionally: this provider exists to draw from the Claude plan,
 * and inheriting `ANTHROPIC_API_KEY` would silently flip it to pay-as-you-go
 * billing. An explicit token (from `claude setup-token`) rides in as
 * `CLAUDE_CODE_OAUTH_TOKEN`; without one the CLI falls back to the machine's
 * own `claude` login.
 */
export function buildSdkEnv(
  base: NodeJS.ProcessEnv,
  oauthToken: string | undefined,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...base };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  if (oauthToken) env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'runvane';
  return env;
}

/**
 * Anthropic usage → runvane convention: `promptTokens` is the full prompt
 * context (cache reads/creations included, matching OpenAI `prompt_tokens`
 * semantics the rest of the app assumes), `cachedPromptTokens` the cache-read
 * share. Subscription usage is not billed per-token, so no `costUsd`.
 */
export function mapSdkUsage(raw: unknown): LlmUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const input = num(rec.input_tokens);
  const cacheRead = num(rec.cache_read_input_tokens);
  const cacheCreation = num(rec.cache_creation_input_tokens);
  const output = num(rec.output_tokens);
  if (input + cacheRead + cacheCreation + output === 0) return undefined;
  return {
    promptTokens: input + cacheRead + cacheCreation,
    completionTokens: output,
    ...(cacheRead > 0 ? { cachedPromptTokens: cacheRead } : {}),
  };
}

/** Shown when live discovery via `supportedModels()` is unavailable. */
export const CLAUDE_SUBSCRIPTION_FALLBACK_MODELS = [
  'claude-fable-5',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5',
  'opus',
  'sonnet',
  'haiku',
];
