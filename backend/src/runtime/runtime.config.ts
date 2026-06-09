export type LlmRuntime =
  | { mode: 'live' }
  | { mode: 'stub'; streamDelayMs?: number; models?: readonly string[] };

export type RunvaneRuntimeConfig = {
  llm: LlmRuntime;
  nodeEnv: 'development' | 'test' | 'production';
};
