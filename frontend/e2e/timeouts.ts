const live = process.env.E2E_LIVE_LLM === '1';

/** Stub backend: UI should appear in <1s. Live LLM: allow more slack. */
export const E2E_UI_TIMEOUT_MS = Number(
  process.env.E2E_UI_TIMEOUT_MS ?? (live ? 5_000 : 1_000),
);

/** Stub backend: probe completes in a few hundred ms; 3s cap catches regressions. */
export const E2E_LLM_TIMEOUT_MS = Number(
  process.env.E2E_LLM_TIMEOUT_MS ?? (live ? 45_000 : 3_000),
);
