import { Injectable } from '@nestjs/common';
import type { LlmProviderSettingSpec, ProviderSettingsDict } from '../provider.js';
import { OpenAiCompatibleProvider } from './openAiCompatible.js';

/**
 * LM Studio exposes two HTTP surfaces:
 *   - `/api/v0/...` (or `/api/v1/...`) — native, takes raw `input: string`,
 *     bypassing the model's chat template entirely.
 *   - `/v1/...` — OpenAI Chat Completions compatible. The server applies the
 *     model's chat template (ChatML, Llama, Gemma, …) using its real special
 *     tokens, which is what we want for any structured prompting.
 *
 * This adapter is just an OpenAI-compatible provider pointed at LM Studio's
 * `/v1` surface. No API key required. Base URL is normalized so legacy
 * `/api/v1` configurations keep working without a manual setting edit.
 */
@Injectable()
export class LmStudioNativeProvider extends OpenAiCompatibleProvider {
  constructor() {
    super('lmstudio', 'LM Studio', 'http://127.0.0.1:1234/v1', { requireApiKey: false });
  }

  override getSettingsSpec(): LlmProviderSettingSpec[] {
    return [{ key: 'base_url', label: 'Base URL', type: 'url', required: true }];
  }

  protected override mergedSettings(settings: ProviderSettingsDict): ProviderSettingsDict {
    const raw = String(settings.base_url ?? 'http://127.0.0.1:1234/v1').trim().replace(/\/$/, '');
    const base = normalizeLmStudioBase(raw);
    return { ...settings, base_url: base };
  }
}

function normalizeLmStudioBase(base: string): string {
  if (!base) return 'http://127.0.0.1:1234/v1';
  // Order matters: `/api/v1` also ends with `/v1`, so handle the legacy
  // native paths first and rewrite them to the OpenAI-compat `/v1` surface.
  if (base.endsWith('/api/v1') || base.endsWith('/api/v0')) {
    return `${base.slice(0, base.lastIndexOf('/api/'))}/v1`;
  }
  if (base.endsWith('/v1')) return base;
  return `${base}/v1`;
}
