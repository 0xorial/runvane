import { Injectable, Logger } from '@nestjs/common';
import type {
  ConnectivityResult,
  LlmProvider,
  LlmProviderSettingSpec,
  ProviderSettingsDict,
} from '../provider.js';
import { StreamInterruptedError, isAbortError } from '../provider.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../types.js';
import { fetchLlm } from './openAiShared.js';
import { AnthropicStreamAccumulator, buildAnthropicBody } from './anthropicShared.js';

/**
 * Native Anthropic Messages API adapter (API-key, pay-as-you-go). Full
 * fidelity: role-based history with tool_use/tool_result blocks, native
 * tools, thinking deltas, and incremental prompt caching via the
 * breakpoints placed in anthropicShared.ts. The `claude-subscription`
 * provider is the plan-billed sibling that goes through the Agent SDK.
 */

const ANTHROPIC_VERSION = '2023-06-01';

function normalizeBaseUrl(settings: ProviderSettingsDict): string {
  return String(settings.base_url ?? '')
    .trim()
    .replace(/\/$/, '');
}

function apiKey(settings: ProviderSettingsDict): string {
  return String(settings.api_key ?? '').trim();
}

@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';
  readonly label = 'Anthropic';
  private readonly logger = new Logger(AnthropicProvider.name);

  getSettingsSpec(): LlmProviderSettingSpec[] {
    return [
      { key: 'api_key', label: 'API key', type: 'secret', required: true },
      { key: 'base_url', label: 'Base URL', type: 'url', required: true },
    ];
  }

  private headers(settings: ProviderSettingsDict): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey(settings),
      'anthropic-version': ANTHROPIC_VERSION,
    };
  }

  async checkConnectivity(settings: ProviderSettingsDict): Promise<ConnectivityResult> {
    const baseUrl = normalizeBaseUrl(settings);
    if (!baseUrl) return { ok: false, detail: 'base_url is required' };
    if (!apiKey(settings)) return { ok: false, detail: 'api_key is required' };
    try {
      const res = await fetch(`${baseUrl}/v1/models?limit=1`, { headers: this.headers(settings) });
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, detail: `connectivity failed (${res.status}): ${body.slice(0, 300)}` };
      }
      return { ok: true, detail: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, detail: `connectivity failed: ${msg}` };
    }
  }

  async listModels(settings: ProviderSettingsDict): Promise<string[]> {
    const baseUrl = normalizeBaseUrl(settings);
    if (!baseUrl) throw new Error('base_url is required');
    const res = await fetch(`${baseUrl}/v1/models?limit=1000`, { headers: this.headers(settings) });
    if (!res.ok) throw new Error(`models fetch failed (${res.status})`);
    const raw = (await res.json()) as { data?: Array<{ id?: unknown }> };
    const models = (Array.isArray(raw.data) ? raw.data : [])
      .map((m) => (typeof m?.id === 'string' ? m.id.trim() : ''))
      .filter((id) => id.length > 0);
    return Array.from(new Set(models));
  }

  async streamCompletion(
    settings: ProviderSettingsDict,
    model: string,
    request: LlmRequest,
    onEvent: (event: LlmStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<LlmCompletion> {
    const baseUrl = normalizeBaseUrl(settings);
    if (!baseUrl) throw new Error('base_url is required');
    if (!apiKey(settings)) throw new Error('api_key is required');
    const requestUrl = `${baseUrl}/v1/messages`;

    this.logger.log(
      { providerId: this.id, model, baseUrl, requestUrl, turns: request.messages.length },
      '[llm-provider] completion request sending',
    );
    const res = await fetchLlm(requestUrl, {
      method: 'POST',
      headers: this.headers(settings),
      body: JSON.stringify(buildAnthropicBody(model, request)),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`llm request failed (${res.status}): ${body.slice(0, 300)}`);
    }

    const acc = new AnthropicStreamAccumulator(onEvent);
    const ingest = (event: Record<string, unknown>): void => {
      acc.recordRawChunk(event);
      try {
        acc.ingest(event);
      } catch (e) {
        // Stream-level `error` events surface as a thrown Error from ingest.
        throw new StreamInterruptedError({
          message: e instanceof Error ? e.message : String(e),
          partialText: acc.partialText(),
          usage: acc.usageValue(),
          cause: e,
        });
      }
    };

    try {
      // Defensive single-JSON fallback (a proxy that ignores stream:true).
      if (!res.body) {
        const message = (await res.json()) as Record<string, unknown>;
        this.ingestWholeMessage(message, acc, ingest);
        if (!acc.hasContent()) this.logger.warn('llm returned empty completion — finalizing as no-op');
        return acc.finalize();
      }

      const decoder = new TextDecoder();
      let buffer = '';
      const handleDataLine = (line: string): void => {
        if (!line.startsWith('data:')) return;
        const payload = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
        if (!payload) return;
        ingest(JSON.parse(payload) as Record<string, unknown>);
      };

      for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        while (true) {
          const nl = buffer.indexOf('\n');
          if (nl < 0) break;
          const line = buffer.slice(0, nl).replace(/\r$/, '');
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          handleDataLine(line);
        }
      }
      if (buffer) handleDataLine(buffer.replace(/\r$/, ''));
      if (!acc.hasContent()) this.logger.warn('llm returned empty streamed completion — finalizing as no-op');
      return acc.finalize();
    } catch (error) {
      if (error instanceof StreamInterruptedError) throw error;
      if (isAbortError(error) || signal?.aborted) {
        throw new StreamInterruptedError({
          message: 'stream aborted',
          partialText: acc.partialText(),
          usage: acc.usageValue(),
          cause: error,
        });
      }
      throw error;
    }
  }

  /** Replay a complete (non-streamed) message through the accumulator. */
  private ingestWholeMessage(
    message: Record<string, unknown>,
    acc: AnthropicStreamAccumulator,
    ingest: (event: Record<string, unknown>) => void,
  ): void {
    ingest({ type: 'message_start', message: { usage: message.usage } });
    const content = Array.isArray(message.content) ? (message.content as Array<Record<string, unknown>>) : [];
    for (const [index, block] of content.entries()) {
      if (block.type === 'text') {
        ingest({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
        ingest({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: String(block.text ?? '') } });
      } else if (block.type === 'thinking') {
        ingest({ type: 'content_block_start', index, content_block: { type: 'thinking' } });
        ingest({
          type: 'content_block_delta',
          index,
          delta: { type: 'thinking_delta', thinking: String(block.thinking ?? '') },
        });
      } else if (block.type === 'tool_use') {
        ingest({ type: 'content_block_start', index, content_block: block });
        ingest({
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) },
        });
      }
    }
    ingest({ type: 'message_delta', delta: { stop_reason: message.stop_reason }, usage: message.usage });
  }
}
