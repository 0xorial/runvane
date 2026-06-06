/** Default: stub backend (npm run dev:stub). Live: E2E_LIVE_LLM=1 or E2E_LLM_TIMEOUT_MS=45000 */
export const E2E_LLM_TIMEOUT_MS = Number(
  process.env.E2E_LLM_TIMEOUT_MS ?? (process.env.E2E_LIVE_LLM === '1' ? 45_000 : 5_000),
);
export const E2E_UI_TIMEOUT_MS = Number(process.env.E2E_UI_TIMEOUT_MS ?? 3_000);
