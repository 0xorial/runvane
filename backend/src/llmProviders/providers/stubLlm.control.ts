export type StubQueuedResponse = {
  text: string;
  /** Per-token stream delay (ms). Omit for instant (title/tool) or provider default. */
  streamMs?: number;
};

export type StubModelScript = {
  /** Omit for title/tool-param fallback queue (not consumed by planner streams). */
  model?: string;
  responses: StubQueuedResponse[];
};

/** Local test harness API for the injected stub LLM (not used in production). */
export interface StubLlmControl {
  /** Queue scripted responses per model (FIFO within each model). */
  configure(scripts: StubModelScript[], opts?: { append?: boolean }): void;
  /** Queue one completion (any model, FIFO fallback). */
  setNextResponse(text: string): void;
  /** Queue multiple completions (any model, FIFO fallback). */
  setNextResponses(...texts: string[]): void;
  reset(): void;
  pendingCount(): number;
}
