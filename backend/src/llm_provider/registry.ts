import type { LlmProvider } from "./provider.js";
import { OpenAiCompatibleProvider } from "./providers/openAiCompatible.js";
import { LmStudioNativeProvider } from "./providers/lmStudioNative.js";

export class LlmProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();

  constructor() {
    this.register(new OpenAiCompatibleProvider("openai", "OpenAI", "https://api.openai.com/v1"));
    this.register(new OpenAiCompatibleProvider("grok", "Grok", "https://api.x.ai/v1"));
    this.register(new LmStudioNativeProvider("lmstudio", "LM Studio", "http://127.0.0.1:1234/api/v1"));
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
