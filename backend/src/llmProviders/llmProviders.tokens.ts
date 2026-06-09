import type { LlmProvider } from './provider.js';

/** Injected list of LLM backends for this process (live providers, stub, or demo). */
export const LLM_PROVIDERS = Symbol('LLM_PROVIDERS');
export type LlmProvidersInject = LlmProvider[];
