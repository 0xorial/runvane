import type { LlmRequest } from '../types.js';

export const PROBE_TIME_USER_MESSAGE = 'what is the time?';
export const STUB_PROBE_TIME_REPLY = 'The current time is 12:00 UTC.';

export async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export function parseStubDelayMs(text: string): number | null {
  const match = text.match(/__stub_delay:(\d+)__/);
  if (!match?.[1]) return null;
  const ms = Number(match[1]);
  if (!Number.isFinite(ms) || ms < 0 || ms > 60_000) return null;
  return Math.trunc(ms);
}

export function isSteerProbeMessage(text: string): boolean {
  return text.includes('__steer_probe__');
}

export function steerProbeReply(): string {
  return JSON.stringify({
    assistant_output: 'Steered response.',
    tool_requests: [],
    followup: 'finalize',
  });
}

export function stubRequestText(request: LlmRequest): string {
  return request.messages
    .flatMap((message) => message.parts)
    .filter((part) => part.kind === 'text')
    .map((part) => part.text)
    .join('\n');
}

export function stubUserText(request: LlmRequest): string {
  return request.messages
    .filter((message) => message.role === 'user')
    .flatMap((message) => message.parts)
    .filter((part) => part.kind === 'text')
    .map((part) => part.text)
    .join('\n');
}

export function stubHasPlannerToolResult(request: LlmRequest): boolean {
  return request.messages.some((message) => message.parts.some((part) => part.kind === 'tool_result'));
}

export function stubIsTitleGenerationRequest(blob: string): boolean {
  return /title this conversation/i.test(blob);
}

export function stubIsToolParamsRequest(blob: string): boolean {
  return /Produce JSON args for tool "/i.test(blob);
}

/** Planner prompts embed this JSON schema instruction; tools are not passed on `request.tools`. */
export function stubIsPlannerRequest(request: LlmRequest): boolean {
  return /Reply with one JSON object/.test(stubRequestText(request));
}

export function stubIsProbeTimeConversation(request: LlmRequest): boolean {
  return stubUserText(request).includes(PROBE_TIME_USER_MESSAGE);
}

export function stubProbeTimePlannerFirstRound(): string {
  return JSON.stringify({
    assistant_thinking: 'User asked for the time; call get_current_time.',
    assistant_output: 'Let me check the current time.',
    tool_requests: [{ tool_name: 'get_current_time', tool_request: 'current server time' }],
    followup: 'continue',
  });
}

export function stubProbeTimePlannerFinalize(): string {
  return JSON.stringify({
    assistant_thinking: 'Tool returned the current time.',
    assistant_output: STUB_PROBE_TIME_REPLY,
    tool_requests: [],
    followup: 'finalize',
  });
}

export function pickStubReply(request: LlmRequest): string {
  const blob = stubRequestText(request);
  if (isSteerProbeMessage(blob)) return steerProbeReply();
  if (stubIsTitleGenerationRequest(blob)) return 'Time Inquiry';
  if (stubIsToolParamsRequest(blob)) return '{}';

  if (stubIsPlannerRequest(request)) {
    if (stubHasPlannerToolResult(request)) return stubProbeTimePlannerFinalize();
    if (stubIsProbeTimeConversation(request)) return stubProbeTimePlannerFirstRound();
    return stubProbeTimePlannerFinalize();
  }

  return stubProbeTimePlannerFinalize();
}
