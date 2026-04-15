import type {
  ConnectivityResult,
  LlmProvider,
  LlmProviderSettingSpec,
  ProviderSettingsDict,
  StreamTextCompletionInput,
  StreamTextCompletionResult,
  StreamTextCompletionUsage,
} from "../provider.js";
import { StreamInterruptedError as StreamInterruptedErrorClass } from "../provider.js";
import { logger } from "../../infra/logger.js";

function normalizeBaseUrl(settings: ProviderSettingsDict): string {
  const raw = String(settings.base_url ?? "").trim();
  return raw.replace(/\/$/, "");
}

function apiKey(settings: ProviderSettingsDict): string {
  return String(settings.api_key ?? "").trim();
}

function usageFromOpenAiPayload(usage: unknown): StreamTextCompletionUsage | undefined {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return undefined;
  const rec = usage as Record<string, unknown>;
  const pt = rec.prompt_tokens;
  const ct = rec.completion_tokens;
  const promptDetails =
    rec.prompt_tokens_details &&
    typeof rec.prompt_tokens_details === "object" &&
    !Array.isArray(rec.prompt_tokens_details)
      ? (rec.prompt_tokens_details as Record<string, unknown>)
      : null;
  const inputDetails =
    rec.input_tokens_details && typeof rec.input_tokens_details === "object" && !Array.isArray(rec.input_tokens_details)
      ? (rec.input_tokens_details as Record<string, unknown>)
      : null;
  const cachedRaw = promptDetails?.cached_tokens ?? inputDetails?.cached_tokens;
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

const DEFAULT_SPEC: LlmProviderSettingSpec[] = [
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
];

type OpenAiCompatibleProviderOptions = {
  requireApiKey?: boolean;
};

function parseModelIdentifier(rawModel: unknown, opts: { requireLlmType: boolean }): string {
  if (rawModel == null || typeof rawModel !== "object") return "";
  const rec = rawModel as {
    id?: unknown;
    key?: unknown;
    type?: unknown;
    status?: unknown;
    state?: unknown;
    loaded?: unknown;
    loaded_instances?: unknown;
  };

  if (opts.requireLlmType && typeof rec.type === "string" && rec.type && rec.type !== "llm") {
    return "";
  }

  if (typeof rec.id === "string" && rec.id.trim()) return rec.id.trim();
  if (typeof rec.key === "string" && rec.key.trim()) return rec.key.trim();

  if (Array.isArray(rec.loaded_instances) && rec.loaded_instances.length > 0) {
    const first = rec.loaded_instances[0];
    if (first != null && typeof first === "object" && typeof (first as { id?: unknown }).id === "string") {
      return String((first as { id: string }).id).trim();
    }
  }
  return "";
}

export class OpenAiCompatibleProvider implements LlmProvider {
  private readonly requireApiKey: boolean;

  constructor(
    public readonly id: string,
    public readonly label: string,
    private readonly defaultBaseUrl: string,
    options: OpenAiCompatibleProviderOptions = {},
  ) {
    this.requireApiKey = options.requireApiKey ?? true;
  }

  getSettingsSpec(): LlmProviderSettingSpec[] {
    if (this.requireApiKey) return DEFAULT_SPEC;
    return DEFAULT_SPEC.map((spec) => (spec.key === "api_key" ? { ...spec, required: false } : spec));
  }

  private mergedSettings(settings: ProviderSettingsDict): ProviderSettingsDict {
    return {
      ...settings,
      base_url: String(settings.base_url ?? this.defaultBaseUrl),
    };
  }

  async checkConnectivity(settingsIn: ProviderSettingsDict): Promise<ConnectivityResult> {
    const settings = this.mergedSettings(settingsIn);
    const baseUrl = normalizeBaseUrl(settings);
    const key = apiKey(settings);
    const requestUrl = `${baseUrl}/models`;

    if (!baseUrl) return { ok: false, detail: "base_url is required" };
    if (this.requireApiKey && !key) return { ok: false, detail: "api_key is required" };

    try {
      logger.info({ providerId: this.id, baseUrl, requestUrl }, "[llm-provider] connectivity request formatted");
      logger.info({ providerId: this.id }, "[llm-provider] connectivity request sending");
      const headers: Record<string, string> = {};
      if (key) headers.Authorization = `Bearer ${key}`;
      const res = await fetch(requestUrl, {
        method: "GET",
        headers,
      });
      logger.info({ providerId: this.id, status: res.status }, "[llm-provider] connectivity response received");
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
    const baseUrl = normalizeBaseUrl(settings);
    const key = apiKey(settings);
    const requestUrl = `${baseUrl}/models`;
    logger.info({ providerId: this.id, baseUrl, requestUrl }, "[llm-provider] models request formatted");
    logger.info({ providerId: this.id }, "[llm-provider] models request sending");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (key) headers.Authorization = `Bearer ${key}`;
    const res = await fetch(requestUrl, {
      method: "GET",
      headers,
    });
    logger.info({ providerId: this.id, status: res.status }, "[llm-provider] models response received");
    if (!res.ok) {
      throw new Error(`models fetch failed (${res.status})`);
    }
    const raw = (await res.json()) as unknown;
    const openAiData =
      raw != null && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)
        ? (raw as { data: unknown[] }).data
        : [];
    const lmStudioData =
      raw != null && typeof raw === "object" && Array.isArray((raw as { models?: unknown }).models)
        ? (raw as { models: unknown[] }).models
        : [];
    const models = [
      ...openAiData.map((x) => parseModelIdentifier(x, { requireLlmType: false })),
      ...lmStudioData.map((x) => parseModelIdentifier(x, { requireLlmType: true })),
    ].filter((x) => x.length > 0);
    const uniqueModels = Array.from(new Set(models));
    logger.info({ providerId: this.id, count: uniqueModels.length }, "[llm-provider] models parsed");
    return uniqueModels;
  }

  async streamTextCompletion(
    settingsIn: ProviderSettingsDict,
    input: StreamTextCompletionInput,
    onDelta: (delta: string) => void,
  ): Promise<StreamTextCompletionResult> {
    const settings = this.mergedSettings(settingsIn);
    const baseUrl = normalizeBaseUrl(settings);
    const key = apiKey(settings);
    const requestUrl = `${baseUrl}/chat/completions`;
    if (!baseUrl) throw new Error("base_url is required");
    if (this.requireApiKey && !key) throw new Error("api_key is required");

    logger.info(
      { providerId: this.id, model: input.model, baseUrl, requestUrl },
      "[llm-provider] completion request sending",
    );
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
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (key) headers.Authorization = `Bearer ${key}`;
    const requestParams = safeRequestParams(input.requestParams);
    const res = await fetch(requestUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...requestParams,
        model: input.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: "user", content: contentParts }],
      }),
    });
    logger.info(
      {
        providerId: this.id,
        model: input.model,
        status: res.status,
        hasBodyStream: Boolean(res.body),
      },
      "[llm-provider] completion response received",
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`llm request failed (${res.status}): ${body.slice(0, 300)}`);
    }

    // Some providers may ignore `stream: true` and return regular JSON.
    if (!res.body) {
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: unknown;
      };
      const content = data.choices?.[0]?.message?.content;
      const text = typeof content === "string" ? content : "";
      if (!text) throw new Error("llm returned empty response");
      const usage = usageFromOpenAiPayload(data.usage);
      try {
        onDelta(text);
      } catch (e) {
        throw new StreamInterruptedErrorClass({
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

    const handleDataLine = (line: string) => {
      if (!line.startsWith("data:")) return;
      const payload = line.startsWith("data: ") ? line.slice(6) : line.slice(5);
      if (!payload || payload === "[DONE]") return;
      const parsed = JSON.parse(payload) as {
        choices?: Array<{
          delta?: { content?: unknown };
          message?: { content?: unknown };
        }>;
        usage?: unknown;
      };
      const u = usageFromOpenAiPayload(parsed.usage);
      if (u) streamUsage = u;
      const choice = parsed.choices?.[0];
      const part = choice?.delta?.content ?? choice?.message?.content;
      const delta = typeof part === "string" ? part : "";
      if (!delta) return;
      full += delta;
      try {
        onDelta(delta);
      } catch (e) {
        throw new StreamInterruptedErrorClass({
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
