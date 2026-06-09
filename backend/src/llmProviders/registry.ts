import { Inject, Injectable } from '@nestjs/common';
import type { LlmProvider } from './provider.js';
import { GrokProvider, OpenAiProvider } from './providers/openAiCompatible.js';
import { OpenRouterProvider } from './providers/openRouter.js';
import { LmStudioNativeProvider } from './providers/lmStudioNative.js';
import { StubLlmProvider } from './providers/stubLlm.js';
import type { RunvaneRuntimeConfig } from '../runtime/runtime.config.js';
import { RUNVANE_RUNTIME } from '../runtime/runtime.tokens.js';

@Injectable()
export class LlmProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();
  private readonly stubOnly: LlmProvider | null;

  constructor(
    openAiProvider: OpenAiProvider,
    openRouterProvider: OpenRouterProvider,
    grokProvider: GrokProvider,
    lmStudioNativeProvider: LmStudioNativeProvider,
    @Inject(RUNVANE_RUNTIME) runtime: RunvaneRuntimeConfig,
  ) {
    if (runtime.llm.mode === 'stub') {
      this.stubOnly = new StubLlmProvider({
        demo: runtime.llm.demo ?? false,
        demoDelayMs: runtime.llm.demoDelayMs ?? 45,
      });
      return;
    }
    this.stubOnly = null;
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
