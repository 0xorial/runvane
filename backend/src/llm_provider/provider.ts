export type ProviderSettingsDict = Record<string, unknown>;

export type LlmProviderSettingSpec = {
  key: string;
  label: string;
  type: "string" | "secret" | "url";
  required: boolean;
  placeholder?: string;
};

export type ConnectivityResult = {
  ok: boolean;
  detail: string | null;
};

export type StreamTextCompletionInput = {
  model: string;
  prompt: string;
  files?: Array<{
    filename: string;
    mimeType: string;
    base64Data: string;
  }>;
};

/** Token usage when the provider includes it (e.g. OpenAI `stream_options.include_usage`). */
export type StreamTextCompletionUsage = {
  promptTokens: number;
  completionTokens: number;
};

export type StreamTextCompletionResult = {
  text: string;
  usage?: StreamTextCompletionUsage;
};

export interface LlmProvider {
  readonly id: string;
  readonly label: string;

  getSettingsSpec(): LlmProviderSettingSpec[];
  checkConnectivity(settings: ProviderSettingsDict): Promise<ConnectivityResult>;
  listModels(settings: ProviderSettingsDict): Promise<string[]>;
  streamTextCompletion(
    settings: ProviderSettingsDict,
    input: StreamTextCompletionInput,
    onDelta: (delta: string) => void,
  ): Promise<StreamTextCompletionResult>;
}
