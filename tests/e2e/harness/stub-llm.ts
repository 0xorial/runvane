import { APIRequestContext, expect } from "@playwright/test";
import { apiBaseUrl } from "./client";

export type StubQueuedResponse = {
  text: string;
  streamMs?: number;
};

export type StubModelScript = {
  model?: string;
  responses: StubQueuedResponse[];
};

/** HTTP bridge to `StubLlmProvider` (test harness only, `nodeEnv=test` + stub mode). */
export async function stubLlmConfigure(
  request: APIRequestContext,
  scripts: StubModelScript[],
  opts?: { append?: boolean },
): Promise<void> {
  const res = await request.post(`${apiBaseUrl()}/test/stub-llm/configure`, {
    data: { scripts, append: opts?.append },
  });
  expect(res.ok()).toBeTruthy();
}

export async function stubLlmSetNextResponse(request: APIRequestContext, text: string): Promise<void> {
  const res = await request.post(`${apiBaseUrl()}/test/stub-llm/set-next-response`, { data: { text } });
  expect(res.ok()).toBeTruthy();
}

export async function stubLlmSetNextResponses(request: APIRequestContext, texts: string[]): Promise<void> {
  const res = await request.post(`${apiBaseUrl()}/test/stub-llm/set-next-responses`, { data: { texts } });
  expect(res.ok()).toBeTruthy();
}

export async function stubLlmReset(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${apiBaseUrl()}/test/stub-llm/reset`);
  expect(res.ok()).toBeTruthy();
}
