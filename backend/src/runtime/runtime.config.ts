export type LlmRuntime =
  | { mode: 'live' }
  | { mode: 'stub'; demo?: boolean; demoDelayMs?: number };

export type RunvaneRuntimeConfig = {
  llm: LlmRuntime;
  nodeEnv: 'development' | 'test' | 'production';
};
