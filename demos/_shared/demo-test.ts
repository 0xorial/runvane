import { test as base, expect } from "../../tests/e2e/fixtures";
import { apiBaseUrl } from "../../tests/e2e/harness/client";

export const test = base;
export { expect };

test.beforeEach(async ({ request }) => {
  const res = await request.get(`${apiBaseUrl()}/health`);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { llmMode?: string };
  expect(body.llmMode, "demo harness must use stub LLM — run `npm run demos`").toBe("stub");
});

export const beat = (ms = 300) => new Promise((r) => setTimeout(r, ms));
