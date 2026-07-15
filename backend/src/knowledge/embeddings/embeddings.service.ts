import { Injectable } from '@nestjs/common';
import { LlmProviderRegistry } from '../../llmProviders/registry.js';
import { LlmProviderSettingsRepo } from '../../db/repositories/llm-provider-settings.repo.js';

/** Cap per-request batch size so large ingests don't build one giant payload. */
const DEFAULT_BATCH = 64;

/**
 * Vendor-neutral embeddings, routed through the same provider abstraction and
 * settings as chat completions. The embedding model is chosen per knowledge storage
 * (ingest and query must share a vector space), so callers pass providerId +
 * model explicitly; settings are resolved from the stored provider config.
 */
@Injectable()
export class EmbeddingsService {
  constructor(
    private readonly registry: LlmProviderRegistry,
    private readonly settingsRepo: LlmProviderSettingsRepo,
  ) {}

  /** Whether the given provider can embed at all (has an `embedTexts` impl). */
  supports(providerId: string): boolean {
    return typeof this.registry.get(providerId)?.embedTexts === 'function';
  }

  /** Embed texts in order; batches internally. Returns one vector per input. */
  async embed(
    providerId: string,
    model: string,
    texts: string[],
    signal?: AbortSignal,
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    const provider = this.registry.get(providerId);
    if (!provider) throw new Error(`embeddings: unknown provider '${providerId}'`);
    if (!provider.embedTexts) {
      throw new Error(`embeddings: provider '${providerId}' does not support embeddings`);
    }
    const settings = (await this.settingsRepo.getProviderSettings(providerId)) ?? {};
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += DEFAULT_BATCH) {
      signal?.throwIfAborted();
      const batch = texts.slice(i, i + DEFAULT_BATCH);
      const vectors = await provider.embedTexts(settings, model, batch, signal);
      if (vectors.length !== batch.length) {
        throw new Error(
          `embeddings: provider '${providerId}' returned ${vectors.length} vectors for ${batch.length} inputs`,
        );
      }
      out.push(...vectors);
    }
    return out;
  }

  /** Convenience for embedding a single query string. */
  async embedOne(providerId: string, model: string, text: string, signal?: AbortSignal): Promise<number[]> {
    const [vector] = await this.embed(providerId, model, [text], signal);
    if (!vector) throw new Error('embeddings: empty result');
    return vector;
  }
}
