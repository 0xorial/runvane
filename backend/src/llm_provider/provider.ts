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
  ): Promise<string>;
}
