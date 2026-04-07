import type {
  ConnectivityResult,
  LlmProvider,
  LlmProviderSettingSpec,
  ProviderSettingsDict,
  StreamTextCompletionInput,
  StreamTextCompletionResult,
  StreamTextCompletionUsage,
} from "../provider.js";
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
  if (typeof pt === "number" && Number.isFinite(pt) && typeof ct === "number" && Number.isFinite(ct)) {
    return { promptTokens: pt, completionTokens: ct };
  }
  const total = rec.total_tokens;
  if (
    typeof total === "number" &&
    Number.isFinite(total) &&
    typeof pt === "number" &&
    Number.isFinite(pt)
  ) {
    return { promptTokens: pt, completionTokens: Math.max(0, total - pt) };
  }
  return undefined;
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

export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    public readonly id: string,
    public readonly label: string,
    private readonly defaultBaseUrl: string,
  ) {}

  getSettingsSpec(): LlmProviderSettingSpec[] {
    return DEFAULT_SPEC;
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

    if (!baseUrl) return { ok: false, detail: "base_url is required" };
    if (!key) return { ok: false, detail: "api_key is required" };

    try {
      logger.info(
        { providerId: this.id, baseUrl },
        "[llm-provider] connectivity request formatted",
      );
      logger.info({ providerId: this.id }, "[llm-provider] connectivity request sending");
      const res = await fetch(`${baseUrl}/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
      });
      logger.info(
        { providerId: this.id, status: res.status },
        "[llm-provider] connectivity response received",
      );
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
    logger.info(
      { providerId: this.id, baseUrl },
      "[llm-provider] models request formatted",
    );
    logger.info({ providerId: this.id }, "[llm-provider] models request sending");
    const res = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
    });
    logger.info(
      { providerId: this.id, status: res.status },
      "[llm-provider] models response received",
    );
    if (!res.ok) {
      throw new Error(`models fetch failed (${res.status})`);
    }
    const raw = (await res.json()) as unknown;
    const data =
      raw != null &&
      typeof raw === "object" &&
      Array.isArray((raw as { data?: unknown }).data)
        ? (raw as { data: unknown[] }).data
        : [];
    const models = data
      .map((x) =>
        x != null && typeof x === "object" && typeof (x as { id?: unknown }).id === "string"
          ? String((x as { id: string }).id)
          : "",
      )
      .filter((x) => x.length > 0);
    logger.info(
      { providerId: this.id, count: models.length },
      "[llm-provider] models parsed",
    );
    return models;
  }

  async streamTextCompletion(
    settingsIn: ProviderSettingsDict,
    input: StreamTextCompletionInput,
    onDelta: (delta: string) => void,
  ): Promise<StreamTextCompletionResult> {
    const settings = this.mergedSettings(settingsIn);
    const baseUrl = normalizeBaseUrl(settings);
    const key = apiKey(settings);
    if (!baseUrl) throw new Error("base_url is required");
    if (!key) throw new Error("api_key is required");

    logger.info(
      { providerId: this.id, model: input.model, baseUrl },
      "[llm-provider] completion request sending",
    );
    const contentParts: Array<Record<string, unknown>> = [
      { type: "text", text: input.prompt },
    ];
    for (const file of input.files ?? []) {
      contentParts.push({
        type: "file",
        file: {
          filename: file.filename,
          file_data: `data:${file.mimeType};base64,${file.base64Data}`,
        },
      });
    }
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
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
      onDelta(text);
      const usage = usageFromOpenAiPayload(data.usage);
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
      onDelta(delta);
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
