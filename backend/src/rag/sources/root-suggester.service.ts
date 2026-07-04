import { Injectable, Logger } from '@nestjs/common';
import { LlmProviderRegistry } from '../../llmProviders/registry.js';
import { LlmProviderSettingsRepo } from '../../db/repositories/llm-provider-settings.repo.js';
import { getCompletionText, textMessage } from '../../llmProviders/types.js';
import { scanRootCandidates, type RootCandidate } from './root-scanner.js';

export type SuggestedRoot = RootCandidate & {
  /** LLM verdict; null when no provider was available (heuristics only). */
  recommended: boolean | null;
  reason: string | null;
};

/** Matched by the stub provider — keep in sync with stubIsSuggestRootsRequest. */
export const SUGGEST_ROOTS_SYSTEM_PROMPT =
  'You review directory scan results for a RAG index and pick which directories are worth indexing. ' +
  'Reply with ONLY a JSON array like [{"relative":"docs","recommend":true,"reason":"..."}] — one entry ' +
  'per scanned directory, a one-line reason each. Prefer documentation and human-authored source; ' +
  'reject generated output, fixtures, and third-party code.';

/**
 * "The agent offers locations": a bounded filesystem scan finds candidate
 * directories, then one LLM call (the app's default chat model) labels each
 * with recommend/reason. Falls back to the bare scan when no provider is
 * configured or the call fails — suggestions must never hard-require an LLM.
 */
@Injectable()
export class RootSuggesterService {
  private readonly logger = new Logger(RootSuggesterService.name);

  constructor(
    private readonly providers: LlmProviderRegistry,
    private readonly providerSettings: LlmProviderSettingsRepo,
  ) {}

  async suggest(base: string): Promise<SuggestedRoot[]> {
    const candidates = await scanRootCandidates(base);
    if (candidates.length === 0) return [];
    const verdicts = await this.annotate(base, candidates);
    return candidates.map((c) => ({
      ...c,
      recommended: verdicts?.get(c.relative)?.recommend ?? null,
      reason: verdicts?.get(c.relative)?.reason ?? null,
    }));
  }

  private async annotate(
    base: string,
    candidates: RootCandidate[],
  ): Promise<Map<string, { recommend: boolean; reason: string }> | null> {
    try {
      const doc = await this.providerSettings.getDocument();
      const providerId = doc.llm_configuration.provider_id;
      const model = doc.llm_configuration.model_name;
      const provider = this.providers.get(providerId);
      if (!provider || !model) return null;
      const settings = await this.providerSettings.getProviderSettings(providerId);
      if (!settings) return null;

      const table = candidates
        .map((c) => `- relative "${c.relative || '.'}": ${c.files} files, e.g. ${c.samples.join(', ')}`)
        .join('\n');
      const completion = await provider.streamCompletion(
        settings,
        model,
        {
          messages: [
            textMessage('system', SUGGEST_ROOTS_SYSTEM_PROMPT),
            textMessage('user', `Base: ${base}\nScanned directories:\n${table}`),
          ],
        },
        () => {},
      );
      const text = getCompletionText(completion);
      const start = text.indexOf('[');
      const end = text.lastIndexOf(']');
      if (start === -1 || end <= start) return null;
      const rows = JSON.parse(text.slice(start, end + 1)) as Array<{
        relative?: unknown;
        recommend?: unknown;
        reason?: unknown;
      }>;
      const out = new Map<string, { recommend: boolean; reason: string }>();
      for (const row of rows) {
        if (typeof row.relative !== 'string') continue;
        const key = row.relative === '.' ? '' : row.relative;
        out.set(key, {
          recommend: row.recommend === true,
          reason: typeof row.reason === 'string' ? row.reason.slice(0, 300) : '',
        });
      }
      return out.size > 0 ? out : null;
    } catch (error) {
      this.logger.warn(`root suggestion LLM pass failed (falling back to scan only): ${String(error)}`);
      return null;
    }
  }
}
