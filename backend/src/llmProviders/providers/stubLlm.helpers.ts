import type { LlmRequest } from '../types.js';

export const PROBE_TIME_USER_MESSAGE = 'what is the time?';
export const STUB_PROBE_TIME_REPLY = 'The current time is 12:00 UTC.';
export const KNOWLEDGE_PROBE_MARKER = '__rag_probe__';
export const STUB_KNOWLEDGE_REPLY = 'Based on the indexed notes, run the Prisma migration to update the schema.';
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

/** Matches KNOWLEDGE_PLANNING_SYSTEM_PROMPT (knowledgePlanningProvider.ts). */
export function stubIsKnowledgePlanningRequest(blob: string): boolean {
  return /compose retrieval queries/i.test(blob);
}

/** Two planned queries: distinct bag-of-words targets exercise dedupe, and
 *  the first one still ranks db.md on top in the forced-retrieval e2e. */
export const STUB_KNOWLEDGE_PLANNING_REPLY = '{"queries":["SQLite database migrations Prisma","schema update"]}';

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
  // Match a REAL summary block (`<attachment_summary id="…" …>`), not the bare
  // `<attachment_summary>` mention inside the ask_attachment tool description —
  // that description is injected into every planner prompt, so a substring test
  // for `<attachment_summary` false-positives on plain conversations (e.g. the
  // probe), shadowing the probe/tool paths and hanging those specs.
  return /<attachment_summary\s+id=/.test(stubRequestText(request));
}

export function stubPlannerListsAskAttachment(request: LlmRequest): boolean {
  // The real planner prompt lists tools one-per-line as `- <name> — <desc>`
  // under a `Tools (…):` header (no colon-immediately-after, and the name is on
  // its own line), so the old `/Tools:.*ask_attachment/` never matched the
  // actual prompt. Match the tool-list entry itself instead.
  return /(^|\n)- ask_attachment\b/.test(stubRequestText(request));
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
    tool_requests: [
      { tool_name: 'get_current_time', tool_request: 'current server time', note: 'check the current time' },
    ],
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

/**
 * Graph-extraction stub: matched on the llm graph builder's system prompt.
 * The reply is derived deterministically from wiki-style annotations in the
 * document itself, so tests control the graph from their fixture files:
 *   `[[Name]]`                 → an entity (mentioned in that chunk)
 *   `[[A]] --relation--> [[B]]` → an edge
 */
export function stubIsGraphExtractionRequest(blob: string): boolean {
  return /You extract a knowledge graph/i.test(blob);
}

/** Matched on the llm graph builder's summarize prompt (entity-description
 *  merge pass). Deterministic constant — tests never depend on its wording. */
export function stubIsGraphSummarizeRequest(blob: string): boolean {
  return /merge fragmented descriptions/i.test(blob);
}

export const STUB_GRAPH_SUMMARY_REPLY = 'Merged entity description (stub).';

export function stubGraphExtractionReply(blob: string): string {
  // Gleaning round (the builder's "anything MISSED?" re-prompt): the fixture
  // annotations already yielded everything on the first pass, so the stub
  // reports nothing new — which also exercises the builder's early-stop.
  if (/MISSED in the previous extraction/i.test(blob)) {
    return JSON.stringify({ entities: [], relations: [] });
  }
  const parts = blob.split(/\[chunk (\d+)\]/);
  const chunks: Array<{ index: number; text: string }> = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    chunks.push({ index: Number(parts[i]), text: parts[i + 1] ?? '' });
  }
  const entityChunks = new Map<string, Set<number>>();
  const relations: Array<{ source: string; target: string; relation: string }> = [];
  for (const { index, text } of chunks) {
    for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const name = match[1]!.trim();
      const set = entityChunks.get(name) ?? new Set<number>();
      set.add(index);
      entityChunks.set(name, set);
    }
    for (const match of text.matchAll(/\[\[([^\]]+)\]\]\s*--([^->]+)-->\s*\[\[([^\]]+)\]\]/g)) {
      relations.push({ source: match[1]!.trim(), relation: match[2]!.trim(), target: match[3]!.trim() });
    }
  }
  return JSON.stringify({
    entities: [...entityChunks].map(([name, set]) => ({ name, chunks: [...set].sort((a, b) => a - b) })),
    relations,
  });
}

/**
 * Drives the knowledge source-management e2e: a user message with
 * KNOWLEDGE_SOURCES_MARKER plus `base=<dir> storage=<name>` makes the planner
 * (1) explore the base via knowledge suggest_sources, (2) add `<base>/docs` via
 * knowledge add_source, then (3) finalize. Tool params are emitted as structured
 * JSON in the tool_request; the params-resolution stub echoes them through.
 */
export const KNOWLEDGE_SOURCES_MARKER = '__rag_sources_probe__';
export const STUB_KNOWLEDGE_SOURCES_REPLY = 'Explored the base and indexed the docs folder into the storage.';

export function stubIsKnowledgeSourcesConversation(request: LlmRequest): boolean {
  return stubUserText(request).includes(KNOWLEDGE_SOURCES_MARKER);
}

function stubCountToolResults(request: LlmRequest): number {
  return request.messages
    .flatMap((message) => message.parts)
    .filter((part) => part.kind === 'tool_result').length;
}

export function stubKnowledgeSourcesPlanner(request: LlmRequest): string {
  const text = stubUserText(request);
  const base = text.match(/base=(\S+)/)?.[1] ?? '';
  const storage = text.match(/storage=(\S+)/)?.[1] ?? '';
  const results = stubCountToolResults(request);
  if (results === 0) {
    return JSON.stringify({
      assistant_thinking: 'Explore the base directory before picking sources.',
      assistant_output: 'Let me look at what that folder contains.',
      tool_requests: [
        { tool_name: 'knowledge', tool_request: JSON.stringify({ operation: 'suggest_sources', base }) },
      ],
      followup: 'continue',
    });
  }
  if (results === 1) {
    return JSON.stringify({
      assistant_thinking: 'The docs candidate is documentation; add it to the storage.',
      assistant_output: 'Indexing the docs folder.',
      tool_requests: [
        {
          tool_name: 'knowledge',
          tool_request: JSON.stringify({ operation: 'add_source', storage, roots: [`${base}/docs`] }),
        },
      ],
      followup: 'continue',
    });
  }
  return JSON.stringify({
    assistant_thinking: 'Source added and indexing started.',
    assistant_output: STUB_KNOWLEDGE_SOURCES_REPLY,
    tool_requests: [],
    followup: 'finalize',
  });
}

/**
 * Drives the orientation e2e: a user message with KNOWLEDGE_ORIENT_MARKER plus
 * `storage=<name> source=<label>` makes the planner (1) list_storages with the
 * source listing, (2) read_source the given label, then (3) finalize.
 */
export const KNOWLEDGE_ORIENT_MARKER = '__rag_orient_probe__';
export const STUB_KNOWLEDGE_ORIENT_REPLY = 'Oriented: listed the storages and read the full source.';

export function stubIsKnowledgeOrientConversation(request: LlmRequest): boolean {
  return stubUserText(request).includes(KNOWLEDGE_ORIENT_MARKER);
}

export function stubKnowledgeOrientPlanner(request: LlmRequest): string {
  const text = stubUserText(request);
  const storage = text.match(/storage=(\S+)/)?.[1] ?? '';
  const source = text.match(/source=(\S+)/)?.[1] ?? '';
  const results = stubCountToolResults(request);
  if (results === 0) {
    return JSON.stringify({
      assistant_thinking: 'Orient over the indexed storages first.',
      assistant_output: 'Checking what is indexed.',
      tool_requests: [
        { tool_name: 'knowledge', tool_request: JSON.stringify({ operation: 'list_storages', storage }) },
      ],
      followup: 'continue',
    });
  }
  if (results === 1) {
    return JSON.stringify({
      assistant_thinking: 'The chunks alone are not enough — read the whole source.',
      assistant_output: 'Reading the full document.',
      tool_requests: [
        { tool_name: 'knowledge', tool_request: JSON.stringify({ operation: 'read_source', storage, source }) },
      ],
      followup: 'continue',
    });
  }
  return JSON.stringify({
    assistant_thinking: 'Storage listing and full source in hand.',
    assistant_output: STUB_KNOWLEDGE_ORIENT_REPLY,
    tool_requests: [],
    followup: 'finalize',
  });
}

/**
 * Drives the create-storage e2e: a user message with KNOWLEDGE_CREATE_MARKER plus
 * `base=<dir> name=<storage>` makes the planner (1) explore the base,
 * (2) create a storage named `<storage>` with `<base>/docs` as its root,
 * then (3) finalize.
 */
export const KNOWLEDGE_CREATE_MARKER = '__rag_create_probe__';
export const STUB_KNOWLEDGE_CREATE_REPLY = 'Created a storage and started indexing the docs folder.';

export function stubIsKnowledgeCreateConversation(request: LlmRequest): boolean {
  return stubUserText(request).includes(KNOWLEDGE_CREATE_MARKER);
}

export function stubKnowledgeCreatePlanner(request: LlmRequest): string {
  const text = stubUserText(request);
  const base = text.match(/base=(\S+)/)?.[1] ?? '';
  const name = text.match(/name=(\S+)/)?.[1] ?? '';
  const results = stubCountToolResults(request);
  if (results === 0) {
    return JSON.stringify({
      assistant_thinking: 'No storage exists; explore the base first.',
      assistant_output: 'Let me look at that folder.',
      tool_requests: [
        { tool_name: 'knowledge', tool_request: JSON.stringify({ operation: 'suggest_sources', base }) },
      ],
      followup: 'continue',
    });
  }
  if (results === 1) {
    return JSON.stringify({
      assistant_thinking: 'Docs found; create a storage from the agent template.',
      assistant_output: 'Creating a storage for the docs.',
      tool_requests: [
        {
          tool_name: 'knowledge',
          tool_request: JSON.stringify({ operation: 'create_storage', name, roots: [`${base}/docs`] }),
        },
      ],
      followup: 'continue',
    });
  }
  return JSON.stringify({
    assistant_thinking: 'Storage created and indexing started.',
    assistant_output: STUB_KNOWLEDGE_CREATE_REPLY,
    tool_requests: [],
    followup: 'finalize',
  });
}

/** Drives the knowledge-tool e2e: a user message containing KNOWLEDGE_PROBE_MARKER makes
 *  the planner call the `knowledge` tool once, then finalize. */
export function stubIsKnowledgeProbeConversation(request: LlmRequest): boolean {
  return stubUserText(request).includes(KNOWLEDGE_PROBE_MARKER);
}

export function stubKnowledgePlannerFirstRound(): string {
  return JSON.stringify({
    assistant_thinking: 'User wants indexed notes; query the knowledge tool.',
    assistant_output: 'Let me search the indexed notes.',
    tool_requests: [{ tool_name: 'knowledge', tool_request: 'database migration prisma' }],
    followup: 'continue',
  });
}

export function stubKnowledgePlannerFinalize(): string {
  return JSON.stringify({
    assistant_thinking: 'The knowledge tool returned the relevant chunk.',
    assistant_output: STUB_KNOWLEDGE_REPLY,
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

/**
 * Drives the separate-params-resolution integration test: a user message
 * containing NO_PARAMS_RESOLUTION_MARKER makes the planner call one mock tool
 * with an already-structured JSON tool request — the shape a native
 * tool-call's flattened args would take — then finalize once its result comes
 * back. The tool-params resolver's default reply for an unrecognized tool is
 * always `{}` (see `pickStubReply` below), so comparing the resulting
 * tool-invocation's `parameters` against NO_PARAMS_RESOLUTION_TOOL_REQUEST vs
 * `{}` proves whether the resolver ran at all.
 */
export const NO_PARAMS_RESOLUTION_MARKER = '__no_params_resolution__';
export const NO_PARAMS_RESOLUTION_TOOL = MOCK_FANOUT_TOOL_NAMES[0];
export const NO_PARAMS_RESOLUTION_TOOL_REQUEST = JSON.stringify({ probe: 'direct-from-planner' });
export const STUB_NO_PARAMS_RESOLUTION_REPLY = 'No-params-resolution probe complete.';

export function stubIsNoParamsResolutionConversation(request: LlmRequest): boolean {
  return stubUserText(request).includes(NO_PARAMS_RESOLUTION_MARKER);
}

export function stubNoParamsResolutionFirstRound(): string {
  return JSON.stringify({
    assistant_thinking: 'Call the mock tool with pre-structured JSON args.',
    assistant_output: 'Running the mock tool.',
    tool_requests: [{ tool_name: NO_PARAMS_RESOLUTION_TOOL, tool_request: NO_PARAMS_RESOLUTION_TOOL_REQUEST }],
    followup: 'continue',
  });
}

export function stubNoParamsResolutionFinalize(): string {
  return JSON.stringify({
    assistant_thinking: 'Mock tool settled; summarize.',
    assistant_output: STUB_NO_PARAMS_RESOLUTION_REPLY,
    tool_requests: [],
    followup: 'finalize',
  });
}

/**
 * Drives the direct-dispatch envelope-echo integration test: the planner emits
 * a tool_request whose JSON echoes runvane's own stored bookkeeping keys
 * (tool_request/source/__tool_batch) — the shape a model imitates after seeing
 * replayed context turns. Dispatch must strip them and run the tool cleanly.
 */
export const DIRECT_ENVELOPE_ECHO_MARKER = '__direct_envelope_echo__';
export const STUB_DIRECT_ENVELOPE_ECHO_REPLY = 'Envelope echo probe complete.';
export const DIRECT_ENVELOPE_ECHO_REQUEST = JSON.stringify({
  probe: 'envelope-echo',
  tool_request: '{"probe":"envelope-echo"}',
  source: 'planner_tool_request',
  __tool_batch: '{"id":"model-echoed","size":2}',
});

export function stubIsDirectEnvelopeEchoConversation(request: LlmRequest): boolean {
  return stubUserText(request).includes(DIRECT_ENVELOPE_ECHO_MARKER);
}

export function stubDirectEnvelopeEchoFirstRound(): string {
  return JSON.stringify({
    assistant_thinking: 'Call the mock tool echoing the internal envelope keys.',
    assistant_output: 'Running the mock tool.',
    tool_requests: [{ tool_name: NO_PARAMS_RESOLUTION_TOOL, tool_request: DIRECT_ENVELOPE_ECHO_REQUEST }],
    followup: 'continue',
  });
}

export function stubDirectEnvelopeEchoFinalize(): string {
  return JSON.stringify({
    assistant_thinking: 'Mock tool settled; summarize.',
    assistant_output: STUB_DIRECT_ENVELOPE_ECHO_REPLY,
    tool_requests: [],
    followup: 'finalize',
  });
}

/**
 * Drives the prose-args fallback integration test: the planner emits a
 * NATURAL-LANGUAGE tool_request for a tool whose separate_params_resolution is
 * off. Direct dispatch requires JSON, so the planner must fall back to the
 * params-resolution thought (whose stub reply is `{}`) and the tool must run.
 */
export const DIRECT_PROSE_PARAMS_MARKER = '__direct_prose_params__';
export const STUB_DIRECT_PROSE_PARAMS_REPLY = 'Prose-params probe complete.';

export function stubIsDirectProseParamsConversation(request: LlmRequest): boolean {
  return stubUserText(request).includes(DIRECT_PROSE_PARAMS_MARKER);
}

export function stubDirectProseParamsFirstRound(): string {
  return JSON.stringify({
    assistant_thinking: 'Ask for the time in plain prose despite direct dispatch.',
    assistant_output: 'Checking the time.',
    tool_requests: [{ tool_name: 'get_current_time', tool_request: 'please check the current server time' }],
    followup: 'continue',
  });
}

export function stubDirectProseParamsFinalize(): string {
  return JSON.stringify({
    assistant_thinking: 'Tool settled; summarize.',
    assistant_output: STUB_DIRECT_PROSE_PARAMS_REPLY,
    tool_requests: [],
    followup: 'finalize',
  });
}

/**
 * Drives the fan-in ordering integration test: one decision fans out TWO
 * members — a prose get_current_time request (resolves + runs instantly via
 * the resolution fallback) and a mock tool held open by the test controller.
 * Planning must NOT resume until the held member settles too.
 */
export const DIRECT_MIXED_BATCH_MARKER = '__direct_mixed_batch__';
export const STUB_DIRECT_MIXED_BATCH_REPLY = 'Mixed-batch probe complete.';

export function stubIsDirectMixedBatchConversation(request: LlmRequest): boolean {
  return stubUserText(request).includes(DIRECT_MIXED_BATCH_MARKER);
}

export function stubDirectMixedBatchFirstRound(): string {
  return JSON.stringify({
    assistant_thinking: 'Fan out a fast prose call and a held mock call.',
    assistant_output: 'Running both probes.',
    tool_requests: [
      { tool_name: 'get_current_time', tool_request: 'what time is it right now' },
      { tool_name: NO_PARAMS_RESOLUTION_TOOL, tool_request: JSON.stringify({ probe: 'mixed-batch' }) },
    ],
    followup: 'continue',
  });
}

export function stubDirectMixedBatchFinalize(): string {
  return JSON.stringify({
    assistant_thinking: 'Both members settled; summarize.',
    assistant_output: STUB_DIRECT_MIXED_BATCH_REPLY,
    tool_requests: [],
    followup: 'finalize',
  });
}

/**
 * Drives the direct-dispatch rejection integration test: the planner emits
 * args a strict tool schema rejects (get_current_time takes none). The failed
 * dispatch must surface as a visible error entry and the planner must still
 * reach its final answer instead of looping.
 */
export const DIRECT_BAD_PARAMS_MARKER = '__direct_bad_params__';
export const STUB_DIRECT_BAD_PARAMS_REPLY = 'Direct bad-params probe complete.';

export function stubIsDirectBadParamsConversation(request: LlmRequest): boolean {
  return stubUserText(request).includes(DIRECT_BAD_PARAMS_MARKER);
}

export function stubDirectBadParamsFirstRound(): string {
  return JSON.stringify({
    assistant_thinking: 'Call get_current_time with args its schema rejects.',
    assistant_output: 'Checking the time.',
    tool_requests: [{ tool_name: 'get_current_time', tool_request: JSON.stringify({ bogus: true }) }],
    followup: 'continue',
  });
}

export function stubDirectBadParamsFinalize(): string {
  return JSON.stringify({
    assistant_thinking: 'The tool call failed; wrap up without retrying.',
    assistant_output: STUB_DIRECT_BAD_PARAMS_REPLY,
    tool_requests: [],
    followup: 'finalize',
  });
}

/**
 * Drives the todo_write e2e: a user message containing TODO_PROBE_MARKER makes
 * the planner (1) record a to-do list via `todo_write`, then (2) finalize. The
 * tool_request is structured JSON; the tool-params stub echoes the `todos`
 * payload through verbatim so the resolved call carries the real list.
 */
export const TODO_PROBE_MARKER = '__todo_probe__';
export const STUB_TODO_REPLY = 'Recorded the plan and worked through the steps.';
export const STUB_TODO_ITEMS = [
  { content: 'Explore the codebase', status: 'completed', activeForm: 'Exploring the codebase' },
  { content: 'Implement the feature', status: 'in_progress', activeForm: 'Implementing the feature' },
  { content: 'Write tests', status: 'pending', activeForm: 'Writing tests' },
];

export function stubIsTodoProbeConversation(request: LlmRequest): boolean {
  return stubUserText(request).includes(TODO_PROBE_MARKER);
}

export function stubTodoPlannerFirstRound(): string {
  return JSON.stringify({
    assistant_thinking: 'Lay out the plan as a to-do list before starting.',
    assistant_output: 'Here is my plan.',
    tool_requests: [{ tool_name: 'todo_write', tool_request: JSON.stringify({ todos: STUB_TODO_ITEMS }) }],
    followup: 'continue',
  });
}

export function stubTodoPlannerFinalize(): string {
  return JSON.stringify({
    assistant_thinking: 'Plan recorded; finish up.',
    assistant_output: STUB_TODO_REPLY,
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
    if (/Produce JSON args for tool "knowledge"/.test(blob)) {
      // The user message is the planner's raw tool_request (no prefix — only
      // ask_attachment adds a params-context note). Structured requests from
      // the source-management flow are one-line JSON objects; pass them
      // through verbatim. The schema line also contains "operation" but never
      // starts a line with '{', so scanning whole lines cannot match it.
      for (const line of blob.split('\n').reverse()) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{') || !trimmed.includes('"operation"')) continue;
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          if (typeof parsed.operation === 'string') return JSON.stringify(parsed);
        } catch {
          /* keep scanning */
        }
      }
      return JSON.stringify({ query: 'database migration prisma' });
    }
    if (/Produce JSON args for tool "todo_write"/.test(blob)) {
      // The planner's tool_request is a one-line `{"todos":[…]}` object; echo it
      // through so the resolved call carries the real list instead of `{}`.
      for (const line of blob.split('\n').reverse()) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{') || !trimmed.includes('"todos"')) continue;
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          if (Array.isArray(parsed.todos)) return JSON.stringify(parsed);
        } catch {
          /* keep scanning */
        }
      }
    }
    return '{}';
  }
  if (stubIsGraphExtractionRequest(blob)) return stubGraphExtractionReply(blob);
  if (stubIsGraphSummarizeRequest(blob)) return STUB_GRAPH_SUMMARY_REPLY;
  if (stubIsKnowledgePlanningRequest(blob)) return STUB_KNOWLEDGE_PLANNING_REPLY;
  if (stubIsSummarizeRequest(blob)) return STUB_SUMMARIZE_REPLY;
  if (stubIsGuardrailRequest(blob)) return stubGuardrailFlagReply();
  if (stubIsSummarizeAttachmentRequest(blob)) return STUB_ATTACHMENT_SUMMARY_REPLY;
  if (stubIsAskAttachmentSubagentRequest(blob)) return STUB_ASK_ATTACHMENT_REPLY;

  if (stubIsPlannerRequest(request)) {
    if (stubIsMockFanoutConversation(request)) {
      return stubHasPlannerToolResult(request) ? stubMockFanoutFinalize() : stubMockFanoutFirstRound();
    }
    if (stubIsNoParamsResolutionConversation(request)) {
      return stubHasPlannerToolResult(request) ? stubNoParamsResolutionFinalize() : stubNoParamsResolutionFirstRound();
    }
    if (stubIsDirectEnvelopeEchoConversation(request)) {
      return stubHasPlannerToolResult(request) ? stubDirectEnvelopeEchoFinalize() : stubDirectEnvelopeEchoFirstRound();
    }
    if (stubIsDirectBadParamsConversation(request)) {
      return stubHasPlannerToolResult(request) ? stubDirectBadParamsFinalize() : stubDirectBadParamsFirstRound();
    }
    if (stubIsDirectProseParamsConversation(request)) {
      return stubHasPlannerToolResult(request) ? stubDirectProseParamsFinalize() : stubDirectProseParamsFirstRound();
    }
    if (stubIsDirectMixedBatchConversation(request)) {
      return stubHasPlannerToolResult(request) ? stubDirectMixedBatchFinalize() : stubDirectMixedBatchFirstRound();
    }
    if (stubHasAskAttachmentToolResult(request)) return stubAskAttachmentPlannerFinalize();
    if (stubIsAttachmentFollowUpPlanner(request)) return stubAttachmentFollowUpPlannerFirstRound();
    if (stubIsFirstAttachmentPlanner(request)) return stubFirstAttachmentPlannerFinalize();
    if (stubIsKnowledgeSourcesConversation(request)) return stubKnowledgeSourcesPlanner(request);
    if (stubIsKnowledgeCreateConversation(request)) return stubKnowledgeCreatePlanner(request);
    if (stubIsKnowledgeOrientConversation(request)) return stubKnowledgeOrientPlanner(request);
    if (stubIsKnowledgeProbeConversation(request)) {
      return stubHasPlannerToolResult(request) ? stubKnowledgePlannerFinalize() : stubKnowledgePlannerFirstRound();
    }
    if (stubIsTodoProbeConversation(request)) {
      return stubHasPlannerToolResult(request) ? stubTodoPlannerFinalize() : stubTodoPlannerFirstRound();
    }
    if (stubHasPlannerToolResult(request)) return stubProbeTimePlannerFinalize();
    if (stubIsProbeTimeConversation(request)) return stubProbeTimePlannerFirstRound();
    return stubProbeTimePlannerFinalize();
  }

  return stubProbeTimePlannerFinalize();
}
