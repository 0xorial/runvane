import { DynamicModule, Module, Provider, type Type } from '@nestjs/common';
import type { RunvaneRuntimeConfig } from '../runtime/runtime.config.js';
import { LlmProviderRegistry } from './registry.js';
import { LLM_PROVIDERS } from './llmProviders.tokens.js';
import { GrokProvider, OpenAiProvider } from './providers/openAiCompatible.js';
import { OpenRouterProvider } from './providers/openRouter.js';
import { LmStudioNativeProvider } from './providers/lmStudioNative.js';
import { StubLlmProvider } from './providers/stubLlm.js';

const LIVE_PROVIDERS = [OpenAiProvider, GrokProvider, OpenRouterProvider, LmStudioNativeProvider] as const;

@Module({})
export class LlmProvidersModule {
  static forRoot(runtime: RunvaneRuntimeConfig): DynamicModule {
    const { llm } = runtime;
    const providers: Provider[] = [LlmProviderRegistry];

    if (llm.mode === 'live') {
      providers.push(...LIVE_PROVIDERS, {
        provide: LLM_PROVIDERS,
        useFactory: (openAi: OpenAiProvider, grok: GrokProvider, openRouter: OpenRouterProvider, lmStudio: LmStudioNativeProvider) =>
          [openAi, grok, openRouter, lmStudio],
        inject: [...LIVE_PROVIDERS],
      });
    } else {
      providers.push(
        {
          provide: StubLlmProvider,
          useFactory: () =>
            new StubLlmProvider({
              streamDelayMs: llm.mode === 'stub' ? llm.streamDelayMs : undefined,
              models: llm.mode === 'stub' ? llm.models : undefined,
            }),
        },
        {
          provide: LLM_PROVIDERS,
          useFactory: (stub: StubLlmProvider) => [stub],
          inject: [StubLlmProvider],
        },
      );
    }

    const exports: Type[] = [LlmProviderRegistry];
    if (llm.mode === 'stub') exports.push(StubLlmProvider);

    return {
      module: LlmProvidersModule,
      global: true,
      providers,
      exports,
    };
  }
}
