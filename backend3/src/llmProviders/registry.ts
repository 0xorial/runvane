import { Injectable } from '@nestjs/common';
import type { LlmProvider } from './provider.js';
import { GrokProvider, OpenAiProvider } from './providers/openAiCompatible.js';
import { OpenRouterProvider } from './providers/openRouter.js';
import { LmStudioNativeProvider } from './providers/lmStudioNative.js';

@Injectable()
export class LlmProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();

  constructor(
    openAiProvider: OpenAiProvider,
    openRouterProvider: OpenRouterProvider,
    grokProvider: GrokProvider,
    lmStudioNativeProvider: LmStudioNativeProvider,
  ) {
    this.register(openAiProvider);
    this.register(openRouterProvider);
    this.register(grokProvider);
    this.register(lmStudioNativeProvider);
  }

  register(provider: LlmProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(providerId: string): LlmProvider | null {
    return this.providers.get(providerId) ?? null;
  }

  list(): LlmProvider[] {
    return [...this.providers.values()];
  }
}
