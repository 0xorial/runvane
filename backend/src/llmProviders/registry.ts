import { Injectable } from '@nestjs/common';
import type { LlmProvider } from './provider.js';
import { GrokProvider, OpenAiProvider } from './providers/openAiCompatible.js';
import { OpenRouterProvider } from './providers/openRouter.js';
import { LmStudioNativeProvider } from './providers/lmStudioNative.js';
import { StubLlmProvider } from './providers/stubLlm.js';

@Injectable()
export class LlmProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();
  private readonly stubOnly: LlmProvider | null;

  constructor(
    openAiProvider: OpenAiProvider,
    openRouterProvider: OpenRouterProvider,
    grokProvider: GrokProvider,
    lmStudioNativeProvider: LmStudioNativeProvider,
  ) {
    this.stubOnly = process.env.LLM_TEST_STUB === '1' ? new StubLlmProvider() : null;
    if (this.stubOnly) return;
    this.register(openAiProvider);
    this.register(openRouterProvider);
    this.register(grokProvider);
    this.register(lmStudioNativeProvider);
  }

  register(provider: LlmProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(providerId: string): LlmProvider | null {
    if (this.stubOnly) return this.stubOnly;
    return this.providers.get(providerId) ?? null;
  }

  list(): LlmProvider[] {
    if (this.stubOnly) return [this.stubOnly];
    return [...this.providers.values()];
  }
}
