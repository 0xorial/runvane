/** tests/playwright.demo.config.mts launchOptions.slowMo — added to every Playwright action. */
export const DEMO_PLAYWRIGHT_SLOW_MO_MS = 80;

export function tokenCount(text: string): number {
  return (text.match(/\S+\s*|\s+/g) ?? [text]).length;
}

export function stubStreamMs(text: string, tokenDelayMs: number): number {
  return tokenCount(text) * tokenDelayMs;
}

/** Per-token `streamMs` so the stub stream lasts ~`durationMs` total. */
export function streamMsPerToken(text: string, durationMs: number): number {
  const n = tokenCount(text);
  if (n <= 0) return durationMs;
  return Math.max(1, Math.ceil(durationMs / n));
}

export function perCharDelayMs(
  text: string,
  budgetMs: number,
  slowMoMs = DEMO_PLAYWRIGHT_SLOW_MO_MS,
): number {
  if (budgetMs <= 0) return 0;
  const perKey = budgetMs / text.length - slowMoMs;
  return Math.max(0, Math.floor(perKey));
}
