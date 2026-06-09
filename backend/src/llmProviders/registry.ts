import { Inject, Injectable } from '@nestjs/common';
import type { LlmProvider } from './provider.js';
import { LLM_PROVIDERS, type LlmProvidersInject } from './llmProviders.tokens.js';

@Injectable()
export class LlmProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();
  /** When only one backend is wired (stub/demo harness), route every provider_id to it. */
  private readonly singleProvider: LlmProvider | null;

  constructor(@Inject(LLM_PROVIDERS) providers: LlmProvidersInject) {
    for (const provider of providers) this.register(provider);
    this.singleProvider = providers.length === 1 ? providers[0]! : null;
  }

  register(provider: LlmProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(providerId: string): LlmProvider | null {
    if (this.singleProvider) return this.singleProvider;
    return this.providers.get(providerId) ?? null;
  }

  list(): LlmProvider[] {
    if (this.singleProvider) return [this.singleProvider];
    return [...this.providers.values()];
  }
}
