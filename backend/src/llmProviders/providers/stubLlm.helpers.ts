import type { LlmRequest } from '../types.js';

export const PROBE_TIME_USER_MESSAGE = 'what is the time?';
export const STUB_PROBE_TIME_REPLY = 'The current time is 12:00 UTC.';
export const RAG_PROBE_MARKER = '__rag_probe__';
export const STUB_RAG_REPLY = 'Based on the indexed notes, run the Prisma migration to update the schema.';
export const STUB_SUMMARIZE_REPLY = 'e2e stub summary of folded turns.';
export const STUB_ATTACHMENT_SUMMARY_REPLY = 'e2e stub attachment summary.';
export const STUB_ASK_ATTACHMENT_REPLY =
  'Dominant palette: deep violet on pure black. Mood: precise, technical, premium — suited to developer tooling.';
export const STUB_GUARDRAIL_FLAG_REASON = 'e2e stub guardrail flag';

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

export const STUB_CATEGORY_REPLY = 'Coding';

export function stubIsTitleGenerationRequest(blob: string): boolean {
  return /title this conversation/i.test(blob);
}

/** Auto-categorizer requests carry this fixed, prompt-independent reminder. */
export function stubIsCategorizationRequest(blob: string): boolean {
  return /Reply with ONLY the category name/i.test(blob);
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

export function stubIsSummarizeRequest(blob: string): boolean {
  return /Condense the following conversation turns/i.test(blob);
}

export function stubIsGuardrailRequest(blob: string): boolean {
  return /Tool name:/i.test(blob) && /Respond with JSON only/i.test(blob);
}

export function stubIsSummarizeAttachmentRequest(blob: string): boolean {
  return /You summarize a single attachment/i.test(blob);
}

export function stubIsAskAttachmentSubagentRequest(blob: string): boolean {
  return /You are a focused retrieval subagent/i.test(blob);
}

export function stubIsAskAttachmentToolParamsRequest(blob: string): boolean {
  return /Produce JSON args for tool "ask_attachment"/i.test(blob);
}

export function stubAskAttachmentParamsReply(blob: string): string {
  const idMatch = blob.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  const attachmentId = idMatch?.[0];
  if (!attachmentId) {
    throw new Error('stub ask_attachment params: no attachment_id found in tool-params prompt');
  }
  const plannerRequest = blob.split('Planner request:')[1]?.trim();
  const question =
    plannerRequest && plannerRequest.length > 0
      ? plannerRequest
      : 'What detail does the attachment add beyond the summary?';
  return JSON.stringify({ attachment_id: attachmentId, question });
}

export function stubPlannerUserTurnCount(request: LlmRequest): number {
  return request.messages.filter((message) => message.role === 'user').length;
}

export function stubPlannerHasAttachmentSummary(request: LlmRequest): boolean {
  return stubRequestText(request).includes('<attachment_summary');
}

export function stubPlannerListsAskAttachment(request: LlmRequest): boolean {
  return /Tools:.*ask_attachment/.test(stubRequestText(request));
}

export function stubHasAskAttachmentToolResult(request: LlmRequest): boolean {
  return request.messages.some((message) =>
    message.parts.some(
      (part) => part.kind === 'tool_result' && String(part.payload).includes('"answer"'),
    ),
  );
}

export function stubIsFirstAttachmentPlanner(request: LlmRequest): boolean {
  return (
    stubIsPlannerRequest(request) &&
    stubPlannerHasAttachmentSummary(request) &&
    stubPlannerUserTurnCount(request) === 1 &&
    !stubHasPlannerToolResult(request)
  );
}

export function stubIsAttachmentFollowUpPlanner(request: LlmRequest): boolean {
  return (
    stubIsPlannerRequest(request) &&
    stubPlannerHasAttachmentSummary(request) &&
    stubPlannerListsAskAttachment(request) &&
    stubPlannerUserTurnCount(request) >= 2 &&
    !stubHasPlannerToolResult(request)
  );
}

export function stubFirstAttachmentPlannerFinalize(): string {
  return JSON.stringify({
    assistant_thinking: 'Summarize-attachment already distilled the file; answer from the summary block.',
    assistant_output:
      'The attachment notes describe fixture text used to exercise inline and summary attachment modes.',
    tool_requests: [],
    followup: 'finalize',
  });
}

export function stubAttachmentFollowUpPlannerFirstRound(): string {
  return JSON.stringify({
    assistant_thinking: 'Summary lacks full visual detail; query the attachment via subagent.',
    assistant_output: 'Let me inspect the full file for precise palette and mood.',
    tool_requests: [
      {
        tool_name: 'ask_attachment',
        tool_request: 'What exact palette and mood does the full attachment convey?',
      },
    ],
    followup: 'continue',
  });
}

export function stubAskAttachmentPlannerFinalize(): string {
  return JSON.stringify({
    assistant_thinking: 'Subagent returned palette and mood from the raw file.',
    assistant_output:
      'Cool violet on black — modern, technical, premium dark-UI mood, well suited to a developer tool.',
    tool_requests: [],
    followup: 'finalize',
  });
}

export function stubGuardrailFlagReply(): string {
  return JSON.stringify({ verdict: 'flag', reason: STUB_GUARDRAIL_FLAG_REASON });
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

/** Drives the rag-tool e2e: a user message containing RAG_PROBE_MARKER makes
 *  the planner call the `rag` tool once, then finalize. */
export function stubIsRagProbeConversation(request: LlmRequest): boolean {
  return stubUserText(request).includes(RAG_PROBE_MARKER);
}

export function stubRagPlannerFirstRound(): string {
  return JSON.stringify({
    assistant_thinking: 'User wants indexed notes; query the rag tool.',
    assistant_output: 'Let me search the indexed notes.',
    tool_requests: [{ tool_name: 'rag', tool_request: 'database migration prisma' }],
    followup: 'continue',
  });
}

export function stubRagPlannerFinalize(): string {
  return JSON.stringify({
    assistant_thinking: 'The rag tool returned the relevant chunk.',
    assistant_output: STUB_RAG_REPLY,
    tool_requests: [],
    followup: 'finalize',
  });
}

/**
 * Drives the tool-fanout integration tests: a user message containing
 * MOCK_FANOUT_MARKER makes the planner fan out the three mock tools at once,
 * then finalize once their results come back. Tool params resolve to `{}`
 * (default tool-params branch) and any guardrail flags by default
 * (`stubGuardrailFlagReply`), so the test controls outcomes via the mock tool
 * and the approve/deny endpoints rather than via the LLM.
 */
export const MOCK_FANOUT_MARKER = '__mock_fanout__';
export const MOCK_FANOUT_TOOL_NAMES = ['mock_tool_1', 'mock_tool_2', 'mock_tool_3'] as const;
export const STUB_MOCK_FANOUT_REPLY = 'Mock fan-out complete.';

export function stubIsMockFanoutConversation(request: LlmRequest): boolean {
  return stubUserText(request).includes(MOCK_FANOUT_MARKER);
}

export function stubMockFanoutFirstRound(): string {
  return JSON.stringify({
    assistant_thinking: 'Fan out the three mock tools in one decision.',
    assistant_output: 'Running the mock tools.',
    tool_requests: MOCK_FANOUT_TOOL_NAMES.map((name) => ({
      tool_name: name,
      tool_request: `invoke ${name}`,
    })),
    followup: 'continue',
  });
}

export function stubMockFanoutFinalize(): string {
  return JSON.stringify({
    assistant_thinking: 'All mock tools settled; summarize.',
    assistant_output: STUB_MOCK_FANOUT_REPLY,
    tool_requests: [],
    followup: 'finalize',
  });
}

export function pickStubReply(request: LlmRequest): string {
  const blob = stubRequestText(request);
  if (isSteerProbeMessage(blob)) return steerProbeReply();
  if (stubIsTitleGenerationRequest(blob)) return 'Time Inquiry';
  if (stubIsCategorizationRequest(blob)) return STUB_CATEGORY_REPLY;
  if (stubIsToolParamsRequest(blob)) {
    if (stubIsAskAttachmentToolParamsRequest(blob)) return stubAskAttachmentParamsReply(blob);
    if (/Produce JSON args for tool "rag"/.test(blob)) {
      return JSON.stringify({ query: 'database migration prisma' });
    }
    return '{}';
  }
  if (stubIsSummarizeRequest(blob)) return STUB_SUMMARIZE_REPLY;
  if (stubIsGuardrailRequest(blob)) return stubGuardrailFlagReply();
  if (stubIsSummarizeAttachmentRequest(blob)) return STUB_ATTACHMENT_SUMMARY_REPLY;
  if (stubIsAskAttachmentSubagentRequest(blob)) return STUB_ASK_ATTACHMENT_REPLY;

  if (stubIsPlannerRequest(request)) {
    if (stubIsMockFanoutConversation(request)) {
      return stubHasPlannerToolResult(request) ? stubMockFanoutFinalize() : stubMockFanoutFirstRound();
    }
    if (stubHasAskAttachmentToolResult(request)) return stubAskAttachmentPlannerFinalize();
    if (stubIsAttachmentFollowUpPlanner(request)) return stubAttachmentFollowUpPlannerFirstRound();
    if (stubIsFirstAttachmentPlanner(request)) return stubFirstAttachmentPlannerFinalize();
    if (stubIsRagProbeConversation(request)) {
      return stubHasPlannerToolResult(request) ? stubRagPlannerFinalize() : stubRagPlannerFirstRound();
    }
    if (stubHasPlannerToolResult(request)) return stubProbeTimePlannerFinalize();
    if (stubIsProbeTimeConversation(request)) return stubProbeTimePlannerFirstRound();
    return stubProbeTimePlannerFinalize();
  }

  return stubProbeTimePlannerFinalize();
}
