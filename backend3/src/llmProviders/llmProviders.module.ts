import { Module } from '@nestjs/common';
import { LlmProviderRegistry } from './registry.js';
import { GrokProvider, OpenAiProvider } from './providers/openAiCompatible.js';
import { OpenRouterProvider } from './providers/openRouter.js';
import { LmStudioNativeProvider } from './providers/lmStudioNative.js';

@Module({
  providers: [OpenAiProvider, GrokProvider, OpenRouterProvider, LmStudioNativeProvider, LlmProviderRegistry],
  exports: [LlmProviderRegistry],
})
export class LlmProvidersModule {}
