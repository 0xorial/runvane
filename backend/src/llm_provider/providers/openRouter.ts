import type {
  ConnectivityResult,
  LlmProvider,
  LlmProviderSettingSpec,
  ProviderSettingsDict,
  StreamTextCompletionInput,
  StreamTextCompletionResult,
  StreamTextCompletionUsage,
} from "../provider.js";
import { StreamInterruptedError } from "../provider.js";
import { logger } from "../../infra/logger.js";

const SETTINGS_SPEC: LlmProviderSettingSpec[] = [
  {
    key: "api_key",
    label: "API key",
    type: "secret",
    required: true,
  },
  {
    key: "base_url",
    label: "Base URL",
    type: "url",
    required: true,
  },
  {
    key: "http_referer",
    label: "HTTP Referer",
    type: "url",
    required: false,
  },
  {
    key: "x_title",
    label: "X-Title",
    type: "string",
    required: false,
  },
];

function normalizeBaseUrl(settings: ProviderSettingsDict, defaultBaseUrl: string): string {
  const raw = String(settings.base_url ?? defaultBaseUrl).trim();
  return raw.replace(/\/$/, "");
}

function apiKey(settings: ProviderSettingsDict): string {
  return String(settings.api_key ?? "").trim();
}

function buildHeaders(settings: ProviderSettingsDict): Record<string, string> {
  const key = apiKey(settings);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (key) headers.Authorization = `Bearer ${key}`;
  const referer = String(settings.http_referer ?? "").trim();
  const title = String(settings.x_title ?? "").trim();
  if (referer) headers["HTTP-Referer"] = referer;
  if (title) headers["X-Title"] = title;
  return headers;
}

function usageFromOpenRouterPayload(usage: unknown): StreamTextCompletionUsage | undefined {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return undefined;
  const rec = usage as Record<string, unknown>;
  const pt = rec.prompt_tokens;
  const ct = rec.completion_tokens;
  const details =
    rec.prompt_tokens_details &&
    typeof rec.prompt_tokens_details === "object" &&
    !Array.isArray(rec.prompt_tokens_details)
      ? (rec.prompt_tokens_details as Record<string, unknown>)
      : null;
  const cachedRaw = details?.cached_tokens;
  const cachedPromptTokens =
    typeof cachedRaw === "number" && Number.isFinite(cachedRaw) ? Math.max(0, Math.trunc(cachedRaw)) : undefined;

  if (typeof pt === "number" && Number.isFinite(pt) && typeof ct === "number" && Number.isFinite(ct)) {
    return {
      promptTokens: pt,
      completionTokens: ct,
      ...(cachedPromptTokens !== undefined
        ? { cachedPromptTokens: Math.min(cachedPromptTokens, Math.max(0, Math.trunc(pt))) }
        : {}),
    };
  }
  const total = rec.total_tokens;
  if (typeof total === "number" && Number.isFinite(total) && typeof pt === "number" && Number.isFinite(pt)) {
    return {
      promptTokens: pt,
      completionTokens: Math.max(0, total - pt),
      ...(cachedPromptTokens !== undefined
        ? { cachedPromptTokens: Math.min(cachedPromptTokens, Math.max(0, Math.trunc(pt))) }
        : {}),
    };
  }
  return undefined;
}

function safeRequestParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!params) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!key) continue;
    if (
      key === "model" ||
      key === "messages" ||
      key === "stream" ||
      key === "stream_options" ||
      key === "input" ||
      key === "prompt"
    ) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function parseModelIdentifier(rawModel: unknown): string {
  if (rawModel == null || typeof rawModel !== "object") return "";
  const rec = rawModel as { id?: unknown };
  return typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : "";
}

export class OpenRouterProvider implements LlmProvider {
  constructor(
    public readonly id: string,
    public readonly label: string,
    private readonly defaultBaseUrl: string,
  ) {}

  getSettingsSpec(): LlmProviderSettingSpec[] {
    return SETTINGS_SPEC;
  }

  private mergedSettings(settings: ProviderSettingsDict): ProviderSettingsDict {
    return {
      ...settings,
      base_url: String(settings.base_url ?? this.defaultBaseUrl),
    };
  }

  private async fetchModelsPayload(settingsIn: ProviderSettingsDict): Promise<unknown[]> {
    const settings = this.mergedSettings(settingsIn);
    const baseUrl = normalizeBaseUrl(settings, this.defaultBaseUrl);
    const key = apiKey(settings);
    const requestUrl = `${baseUrl}/models`;
    if (!baseUrl) throw new Error("base_url is required");
    if (!key) throw new Error("api_key is required");
    const res = await fetch(requestUrl, {
      method: "GET",
      headers: buildHeaders(settings),
    });
    if (!res.ok) {
      throw new Error(`models fetch failed (${res.status})`);
    }
    const raw = (await res.json()) as unknown;
    return raw != null && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)
      ? (raw as { data: unknown[] }).data
      : [];
  }

  async checkConnectivity(settingsIn: ProviderSettingsDict): Promise<ConnectivityResult> {
    const settings = this.mergedSettings(settingsIn);
    const baseUrl = normalizeBaseUrl(settings, this.defaultBaseUrl);
    const key = apiKey(settings);
    const requestUrl = `${baseUrl}/models`;

    if (!baseUrl) return { ok: false, detail: "base_url is required" };
    if (!key) return { ok: false, detail: "api_key is required" };

    try {
      logger.info(
        { providerId: this.id, baseUrl, requestUrl },
        "[llm-provider] openrouter connectivity request sending",
      );
      const res = await fetch(requestUrl, {
        method: "GET",
        headers: buildHeaders(settings),
      });
      if (!res.ok) {
        const body = await res.text();
        return {
          ok: false,
          detail: `connectivity failed (${res.status}): ${body.slice(0, 300)}`,
        };
      }
      return { ok: true, detail: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, detail: `connectivity failed: ${msg}` };
    }
  }

  async listModels(settingsIn: ProviderSettingsDict): Promise<string[]> {
    const settings = this.mergedSettings(settingsIn);
    const baseUrl = normalizeBaseUrl(settings, this.defaultBaseUrl);
    logger.info(
      { providerId: this.id, baseUrl, requestUrl: `${baseUrl}/models` },
      "[llm-provider] openrouter models request sending",
    );
    const data = await this.fetchModelsPayload(settingsIn);
    return Array.from(new Set(data.map(parseModelIdentifier).filter((x) => x.length > 0)));
  }

  listModelCapabilitiesFromPayload(payload: unknown[]): Array<{
    model_name: string;
    supports_image_input: boolean;
    supports_file_input: boolean;
    max_context_tokens: number | null;
    max_output_tokens: number | null;
    input_cost_per_1m: number | null;
    cached_input_cost_per_1m: number | null;
    output_cost_per_1m: number | null;
    currency: string;
  }> {
    const parseUsdPerTokenToPer1M = (raw: unknown): number | null => {
      if (typeof raw !== "string") return null;
      const n = Number(raw.trim());
      if (!Number.isFinite(n)) return null;
      return n * 1_000_000;
    };

    return payload
      .map((raw) => {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
        const rec = raw as Record<string, unknown>;
        const model_name = parseModelIdentifier(raw);
        if (!model_name) return null;

        const architecture =
          rec.architecture && typeof rec.architecture === "object" && !Array.isArray(rec.architecture)
            ? (rec.architecture as Record<string, unknown>)
            : {};
        const inputModalities = Array.isArray(architecture.input_modalities)
          ? architecture.input_modalities
              .map((x) =>
                String(x || "")
                  .trim()
                  .toLowerCase(),
              )
              .filter((x) => x.length > 0)
          : [];
        const supports_image_input = inputModalities.includes("image");
        const supports_file_input = inputModalities.includes("file");

        const contextRaw = rec.context_length;
        const max_context_tokens =
          typeof contextRaw === "number" && Number.isFinite(contextRaw) ? Math.trunc(contextRaw) : null;

        const topProvider =
          rec.top_provider && typeof rec.top_provider === "object" && !Array.isArray(rec.top_provider)
            ? (rec.top_provider as Record<string, unknown>)
            : {};
        const maxOutputRaw = topProvider.max_completion_tokens;
        const max_output_tokens =
          typeof maxOutputRaw === "number" && Number.isFinite(maxOutputRaw) ? Math.trunc(maxOutputRaw) : null;

        const pricing =
          rec.pricing && typeof rec.pricing === "object" && !Array.isArray(rec.pricing)
            ? (rec.pricing as Record<string, unknown>)
            : {};
        const input_cost_per_1m = parseUsdPerTokenToPer1M(pricing.prompt);
        const cached_input_cost_per_1m = parseUsdPerTokenToPer1M(pricing.input_cache_read);
        const output_cost_per_1m = parseUsdPerTokenToPer1M(pricing.completion);

        return {
          model_name,
          supports_image_input,
          supports_file_input,
          max_context_tokens,
          max_output_tokens,
          input_cost_per_1m,
          cached_input_cost_per_1m,
          output_cost_per_1m,
          currency: "USD",
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  async listModelCapabilities(settingsIn: ProviderSettingsDict): Promise<
    Array<{
      model_name: string;
      supports_image_input: boolean;
      supports_file_input: boolean;
      max_context_tokens: number | null;
      max_output_tokens: number | null;
      input_cost_per_1m: number | null;
      cached_input_cost_per_1m: number | null;
      output_cost_per_1m: number | null;
      currency: string;
    }>
  > {
    const payload = await this.fetchModelsPayload(settingsIn);
    return this.listModelCapabilitiesFromPayload(payload);
  }

  async streamTextCompletion(
    settingsIn: ProviderSettingsDict,
    input: StreamTextCompletionInput,
    onDelta: (delta: string) => void,
  ): Promise<StreamTextCompletionResult> {
    const settings = this.mergedSettings(settingsIn);
    const baseUrl = normalizeBaseUrl(settings, this.defaultBaseUrl);
    const requestUrl = `${baseUrl}/chat/completions`;
    const key = apiKey(settings);
    if (!baseUrl) throw new Error("base_url is required");
    if (!key) throw new Error("api_key is required");

    const contentParts: Array<Record<string, unknown>> = [{ type: "text", text: input.prompt }];
    for (const file of input.files ?? []) {
      contentParts.push({
        type: "file",
        file: {
          filename: file.filename,
          file_data: `data:${file.mimeType};base64,${file.base64Data}`,
        },
      });
    }

    const requestParams = safeRequestParams(input.requestParams);
    const res = await fetch(requestUrl, {
      method: "POST",
      headers: buildHeaders(settings),
      body: JSON.stringify({
        ...requestParams,
        model: input.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: "user", content: contentParts }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`llm request failed (${res.status}): ${body.slice(0, 300)}`);
    }

    if (!res.body) {
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: unknown;
      };
      const content = data.choices?.[0]?.message?.content;
      const text = typeof content === "string" ? content : "";
      if (!text) throw new Error("llm returned empty response");
      const usage = usageFromOpenRouterPayload(data.usage);
      try {
        onDelta(text);
      } catch (e) {
        throw new StreamInterruptedError({
          message: "stream interrupted during callback",
          partialText: text,
          usage,
          cause: e,
        });
      }
      return usage !== undefined ? { text, usage } : { text };
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let streamUsage: StreamTextCompletionUsage | undefined;

    const handleDataLine = (line: string): void => {
      if (!line.startsWith("data:")) return;
      const payload = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
      if (!payload || payload === "[DONE]") return;
      const parsed = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }>;
        usage?: unknown;
      };
      const usage = usageFromOpenRouterPayload(parsed.usage);
      if (usage) streamUsage = usage;
      const choice = parsed.choices?.[0];
      const part = choice?.delta?.content ?? choice?.message?.content;
      const delta = typeof part === "string" ? part : "";
      if (!delta) return;
      full += delta;
      try {
        onDelta(delta);
      } catch (e) {
        throw new StreamInterruptedError({
          message: "stream interrupted during callback",
          partialText: full,
          usage: streamUsage,
          cause: e,
        });
      }
    };

    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      while (true) {
        const nl = buffer.indexOf("\n");
        if (nl < 0) break;
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        handleDataLine(line);
      }
    }

    if (buffer) handleDataLine(buffer.replace(/\r$/, ""));
    if (!full) throw new Error("llm returned empty streamed response");
    return streamUsage !== undefined ? { text: full, usage: streamUsage } : { text: full };
  }
}
