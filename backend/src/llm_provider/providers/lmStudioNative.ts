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
    key: "base_url",
    label: "Base URL",
    type: "url",
    required: true,
  },
];

function normalizeBaseUrl(settings: ProviderSettingsDict, defaultBaseUrl: string): string {
  const raw = String(settings.base_url ?? defaultBaseUrl).trim();
  const trimmed = raw.replace(/\/$/, "");
  if (!trimmed) return "";
  if (trimmed.endsWith("/api/v1")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed.slice(0, -3)}/api/v1`;
  return `${trimmed}/api/v1`;
}

function usageFromPayload(usage: unknown): StreamTextCompletionUsage | undefined {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return undefined;
  const rec = usage as Record<string, unknown>;
  const promptTokensRaw = rec.prompt_tokens;
  const completionTokensRaw = rec.completion_tokens;
  const cachedPromptRaw = rec.cached_prompt_tokens ?? rec.cached_tokens;
  const cachedPromptTokens =
    typeof cachedPromptRaw === "number" && Number.isFinite(cachedPromptRaw)
      ? Math.max(0, Math.trunc(cachedPromptRaw))
      : undefined;
  if (
    typeof promptTokensRaw === "number" &&
    Number.isFinite(promptTokensRaw) &&
    typeof completionTokensRaw === "number" &&
    Number.isFinite(completionTokensRaw)
  ) {
    return {
      promptTokens: promptTokensRaw,
      completionTokens: completionTokensRaw,
      ...(cachedPromptTokens !== undefined
        ? {
            cachedPromptTokens: Math.min(
              cachedPromptTokens,
              Math.max(0, Math.trunc(promptTokensRaw)),
            ),
          }
        : {}),
    };
  }
  const totalTokensRaw = rec.total_tokens;
  if (
    typeof promptTokensRaw === "number" &&
    Number.isFinite(promptTokensRaw) &&
    typeof totalTokensRaw === "number" &&
    Number.isFinite(totalTokensRaw)
  ) {
    return {
      promptTokens: promptTokensRaw,
      completionTokens: Math.max(0, totalTokensRaw - promptTokensRaw),
      ...(cachedPromptTokens !== undefined
        ? {
            cachedPromptTokens: Math.min(
              cachedPromptTokens,
              Math.max(0, Math.trunc(promptTokensRaw)),
            ),
          }
        : {}),
    };
  }
  return undefined;
}

function usageFromStats(stats: unknown): StreamTextCompletionUsage | undefined {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return undefined;
  const rec = stats as Record<string, unknown>;
  const promptTokensRaw = rec.input_tokens;
  const completionTokensRaw = rec.total_output_tokens;
  const cachedPromptRaw =
    rec.cached_input_tokens ??
    rec.cache_read_input_tokens ??
    rec.cached_prompt_tokens ??
    rec.cached_tokens;
  const cachedPromptTokens =
    typeof cachedPromptRaw === "number" && Number.isFinite(cachedPromptRaw)
      ? Math.max(0, Math.trunc(cachedPromptRaw))
      : undefined;
  if (
    typeof promptTokensRaw === "number" &&
    Number.isFinite(promptTokensRaw) &&
    typeof completionTokensRaw === "number" &&
    Number.isFinite(completionTokensRaw)
  ) {
    return {
      promptTokens: promptTokensRaw,
      completionTokens: completionTokensRaw,
      ...(cachedPromptTokens !== undefined
        ? {
            cachedPromptTokens: Math.min(
              cachedPromptTokens,
              Math.max(0, Math.trunc(promptTokensRaw)),
            ),
          }
        : {}),
    };
  }
  return undefined;
}

function textFromOutputArray(output: unknown): string {
  if (!Array.isArray(output)) return "";
  const parts = output
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return "";
      const rec = item as { type?: unknown; content?: unknown };
      if (typeof rec.content !== "string" || !rec.content) return "";
      if (typeof rec.type === "string" && rec.type !== "message" && rec.type !== "reasoning") {
        return "";
      }
      return rec.content;
    })
    .filter((x) => x.length > 0);
  return parts.join("");
}

function incrementalSuffix(prev: string, next: string): string {
  if (!next) return "";
  if (!prev) return next;
  if (next === prev) return "";
  if (next.startsWith(prev)) return next.slice(prev.length);
  return "";
}

function textFromChatEndPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const rec = payload as Record<string, unknown>;
  if (typeof rec.type !== "string" || rec.type !== "chat.end") return "";
  const result = rec.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return "";
  return textFromOutputArray((result as { output?: unknown }).output);
}

function extractDeltaFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const rec = payload as Record<string, unknown>;
  if (typeof rec.text === "string" && rec.text) return rec.text;
  if (typeof rec.token === "string" && rec.token) return rec.token;
  if (typeof rec.content === "string" && rec.content) return rec.content;
  if (typeof rec.response === "string" && rec.response) return rec.response;
  if (typeof rec.delta === "string" && rec.delta) return rec.delta;
  const fromOutput = textFromOutputArray(rec.output);
  if (fromOutput) return fromOutput;

  const message = rec.message;
  if (
    message &&
    typeof message === "object" &&
    !Array.isArray(message) &&
    typeof (message as { content?: unknown }).content === "string"
  ) {
    return String((message as { content: string }).content);
  }

  const choices = rec.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const firstRec = first as { delta?: unknown; message?: unknown; text?: unknown };
      if (
        firstRec.delta &&
        typeof firstRec.delta === "object" &&
        !Array.isArray(firstRec.delta) &&
        typeof (firstRec.delta as { content?: unknown }).content === "string"
      ) {
        return String((firstRec.delta as { content: string }).content);
      }
      if (
        firstRec.message &&
        typeof firstRec.message === "object" &&
        !Array.isArray(firstRec.message) &&
        typeof (firstRec.message as { content?: unknown }).content === "string"
      ) {
        return String((firstRec.message as { content: string }).content);
      }
      if (typeof firstRec.text === "string" && firstRec.text) return firstRec.text;
    }
  }
  return "";
}

function parseModelIdentifier(rawModel: unknown): string {
  if (rawModel == null || typeof rawModel !== "object") return "";
  const rec = rawModel as {
    id?: unknown;
    key?: unknown;
    type?: unknown;
    state?: unknown;
    status?: unknown;
    loaded?: unknown;
    loaded_instances?: unknown;
  };
  if (typeof rec.type === "string" && rec.type && rec.type !== "llm") return "";

  if (Array.isArray(rec.loaded_instances) && rec.loaded_instances.length === 0) return "";
  if (typeof rec.loaded === "boolean" && !rec.loaded) return "";
  const state = typeof rec.state === "string" ? rec.state.trim().toLowerCase() : "";
  if (state && state !== "loaded") return "";
  const status = typeof rec.status === "string" ? rec.status.trim().toLowerCase() : "";
  if (status && status !== "loaded") return "";

  if (typeof rec.id === "string" && rec.id.trim()) return rec.id.trim();
  if (typeof rec.key === "string" && rec.key.trim()) return rec.key.trim();
  if (Array.isArray(rec.loaded_instances) && rec.loaded_instances.length > 0) {
    const first = rec.loaded_instances[0];
    if (
      first &&
      typeof first === "object" &&
      !Array.isArray(first) &&
      typeof (first as { id?: unknown }).id === "string"
    ) {
      return String((first as { id: string }).id).trim();
    }
  }
  return "";
}

function safeRequestParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!params) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!key) continue;
    if (key === "model" || key === "stream" || key === "input" || key === "messages" || key === "prompt") {
      continue;
    }
    out[key] = value;
  }
  return out;
}

export class LmStudioNativeProvider implements LlmProvider {
  constructor(
    public readonly id: string,
    public readonly label: string,
    private readonly defaultBaseUrl: string,
  ) {}

  getSettingsSpec(): LlmProviderSettingSpec[] {
    return SETTINGS_SPEC;
  }

  async checkConnectivity(settings: ProviderSettingsDict): Promise<ConnectivityResult> {
    const baseUrl = normalizeBaseUrl(settings, this.defaultBaseUrl);
    const requestUrl = `${baseUrl}/models`;
    if (!baseUrl) return { ok: false, detail: "base_url is required" };
    try {
      logger.info(
        { providerId: this.id, baseUrl, requestUrl },
        "[llm-provider] native connectivity request formatted",
      );
      const res = await fetch(requestUrl, { method: "GET" });
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

  async listModels(settings: ProviderSettingsDict): Promise<string[]> {
    const baseUrl = normalizeBaseUrl(settings, this.defaultBaseUrl);
    const requestUrl = `${baseUrl}/models`;
    logger.info(
      { providerId: this.id, baseUrl, requestUrl },
      "[llm-provider] models request sending",
    );
    const res = await fetch(requestUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    logger.info(
      { providerId: this.id, status: res.status },
      "[llm-provider] models response received",
    );
    if (!res.ok) {
      throw new Error(`models fetch failed (${res.status})`);
    }
    const raw = (await res.json()) as unknown;
    const candidates = [
      ...(Array.isArray(raw) ? raw : []),
      ...(raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)
        ? (raw as { data: unknown[] }).data
        : []),
      ...(raw && typeof raw === "object" && Array.isArray((raw as { models?: unknown }).models)
        ? (raw as { models: unknown[] }).models
        : []),
    ];
    const uniqueModels = Array.from(
      new Set(candidates.map((x) => parseModelIdentifier(x)).filter((x) => x.length > 0)),
    );
    logger.info(
      { providerId: this.id, count: uniqueModels.length },
      "[llm-provider] models parsed",
    );
    return uniqueModels;
  }

  async streamTextCompletion(
    settings: ProviderSettingsDict,
    input: StreamTextCompletionInput,
    onDelta: (delta: string) => void,
  ): Promise<StreamTextCompletionResult> {
    const baseUrl = normalizeBaseUrl(settings, this.defaultBaseUrl);
    const requestUrl = `${baseUrl}/chat`;
    if (!baseUrl) throw new Error("base_url is required");
    logger.info(
      { providerId: this.id, model: input.model, baseUrl, requestUrl },
      "[llm-provider] native completion request sending",
    );
    const requestParams = safeRequestParams(input.requestParams);
    const res = await fetch(requestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...requestParams,
        model: input.model,
        stream: true,
        input: input.prompt,
      }),
    });
    logger.info(
      {
        providerId: this.id,
        model: input.model,
        status: res.status,
        hasBodyStream: Boolean(res.body),
      },
      "[llm-provider] native completion response received",
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`llm request failed (${res.status}): ${body.slice(0, 300)}`);
    }

    if (!res.body) {
      const payload = (await res.json()) as unknown;
      const text = extractDeltaFromPayload(payload);
      if (!text) throw new Error("llm returned empty response");
      let usage: StreamTextCompletionUsage | undefined;
      if (payload && typeof payload === "object") {
        const payloadRec = payload as { usage?: unknown; stats?: unknown; result?: unknown };
        usage = usageFromPayload(payloadRec.usage) ?? usageFromStats(payloadRec.stats);
        if (!usage && payloadRec.result && typeof payloadRec.result === "object") {
          const resultRec = payloadRec.result as { usage?: unknown; stats?: unknown };
          usage = usageFromPayload(resultRec.usage) ?? usageFromStats(resultRec.stats);
        }
      }
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

    const handlePayload = (payloadRaw: string): void => {
      const trimmed = payloadRaw.trim();
      if (!trimmed || trimmed === "[DONE]") return;
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object") {
        const parsedRec = parsed as { usage?: unknown; stats?: unknown; result?: unknown };
        const usage =
          usageFromPayload(parsedRec.usage) ??
          usageFromStats(parsedRec.stats) ??
          (parsedRec.result && typeof parsedRec.result === "object"
            ? usageFromPayload((parsedRec.result as { usage?: unknown }).usage) ??
              usageFromStats((parsedRec.result as { stats?: unknown }).stats)
            : undefined);
        if (usage) streamUsage = usage;
      }
      const chatEndText = textFromChatEndPayload(parsed);
      const delta = chatEndText ? incrementalSuffix(full, chatEndText) : extractDeltaFromPayload(parsed);
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

    const handleLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;
      // LM Studio SSE stream includes non-JSON control lines (event/id/retry/comments).
      if (
        trimmed.startsWith("event:") ||
        trimmed.startsWith("id:") ||
        trimmed.startsWith("retry:") ||
        trimmed.startsWith(":")
      ) {
        return;
      }
      if (trimmed.startsWith("data:")) {
        const payload = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);
        handlePayload(payload);
        return;
      }
      handlePayload(trimmed);
    };

    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      while (true) {
        const nl = buffer.indexOf("\n");
        if (nl < 0) break;
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        handleLine(line);
      }
    }

    if (buffer) handleLine(buffer.replace(/\r$/, ""));
    if (!full) throw new Error("llm returned empty streamed response");
    return streamUsage !== undefined ? { text: full, usage: streamUsage } : { text: full };
  }
}
