/** playwright.demo.config.ts launchOptions.slowMo — added to every Playwright action. */
export const DEMO_PLAYWRIGHT_SLOW_MO_MS = 80;

export function tokenCount(text: string): number {
  return (text.match(/\S+\s*|\s+/g) ?? [text]).length;
}

export function stubStreamMs(text: string, tokenDelayMs: number): number {
  return tokenCount(text) * tokenDelayMs;
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
