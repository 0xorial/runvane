import type { ChatEntry, ThoughtStreamEntry } from '../../contracts/chatEntry.js';
import { textMessage, type LlmContentPart, type LlmMessage } from '../../llmProviders/types.js';

/** What the planner is told about a single available tool. */
export type PlannerToolInfo = {
  name: string;
  /** The tool's model-facing description (getAiDescription). */
  description: string;
  /** For dispatch tools: the values of the `operation` param. Empty otherwise. */
  operations: string[];
};

export type BuildPlannerMessagesInput = {
  systemPrompt: string;
  entries: ChatEntry[];
  tools: PlannerToolInfo[];
  /** Optional context note injected when the user changed this turn's tools. */
  toolChangeNote?: string;
};

/**
 * Pull the dispatch `operation` enum out of a tool's JSON-Schema params, so the
 * planner can see what a single-dispatch tool (e.g. filesystem → read_file /
 * grep / stat) actually does rather than inferring it from the name. Returns
 * [] for tools without an `operation` enum.
 */
export function extractToolOperations(paramsSchema: unknown): string[] {
  if (!paramsSchema || typeof paramsSchema !== 'object') return [];
  const props = (paramsSchema as { properties?: unknown }).properties;
  if (!props || typeof props !== 'object') return [];
  const op = (props as Record<string, unknown>).operation;
  if (!op || typeof op !== 'object') return [];
  const enumVals = (op as { enum?: unknown }).enum;
  if (!Array.isArray(enumVals)) return [];
  return enumVals.filter((v): v is string => typeof v === 'string');
}

function formatToolLine(tool: PlannerToolInfo): string {
  const desc = tool.description.replace(/\s+/g, ' ').trim();
  const ops = tool.operations.length > 0 ? ` Operations: ${tool.operations.join(', ')}.` : '';
  return desc ? `- ${tool.name} — ${desc}${ops}` : `- ${tool.name}${ops}`;
}

/**
 * Build the planner's "tools changed" note by diffing the previous turn's
 * available tools against this turn's. Returns undefined when the effective
 * sets are equal — so a flip-and-back (off then on) produces no note.
 */
export function describeToolChange(
  previousEnabled: readonly string[],
  currentEnabled: readonly string[],
): string | undefined {
  const prevSet = new Set(previousEnabled);
  const curSet = new Set(currentEnabled);
  const added = currentEnabled.filter((name) => !prevSet.has(name));
  const removed = previousEnabled.filter((name) => !curSet.has(name));
  if (added.length === 0 && removed.length === 0) return undefined;
  const parts: string[] = [];
  if (added.length) parts.push(`Newly available: ${added.join(', ')}.`);
  if (removed.length) parts.push(`No longer available: ${removed.join(', ')}.`);
  return `[The user changed this conversation's tools for this turn] ${parts.join(' ')}`;
}

/**
 * Index of `summarize_attachment` thought-stream entries (which carry the
 * persisted `summaryText`) by attachmentId. When multiple exist for the
 * same attachment (e.g. reprocessed), the latest by `conversationIndex`
 * wins — that matches what the user sees in chat.
 */
function indexAttachmentSummaries(entries: ChatEntry[]): Map<string, ThoughtStreamEntry> {
  const out = new Map<string, ThoughtStreamEntry>();
  for (const e of entries) {
    if (e.type !== 'thought_stream' || e.thoughtType !== 'summarize_attachment') continue;
    if (!e.attachmentId) continue;
    const prev = out.get(e.attachmentId);
    if (!prev || prev.conversationIndex < e.conversationIndex) out.set(e.attachmentId, e);
  }
  return out;
}

function plannerSystemContent(agentSystemPrompt: string, tools: PlannerToolInfo[]): string {
  const parts: string[] = [];
  if (agentSystemPrompt.trim().length > 0) parts.push(agentSystemPrompt.trim());
  parts.push(
    tools.length > 0
      ? `Tools (a separate agent fills each call's JSON args from your natural-language request):\n${tools
          .map(formatToolLine)
          .join('\n')}`
      : 'Tools: (none)',
  );
  parts.push(
    'Reply with one JSON object (preferred — it is the only format that lets you set assistant_output and followup explicitly):\n' +
      '{"assistant_thinking": string, "assistant_output": string, "tool_requests": [{"tool_name": string, "tool_request": string}], "followup": "finalize"|"continue"}\n' +
      '`assistant_thinking` is a brief summary of your thoughts and plans for the next step. ' +
      '`assistant_output` is the user-facing text of your response. ' +
      '`tool_requests` is an array of tool requests. ' +
      '`followup` is the mode for the next step: "finalize" if you need to finalize the conversation, "continue" if you need to continue the conversation. ' +
      '`tool_request` is a natural-language brief; a separate agent then fills the JSON args. ' +
      'Use "continue" only if you need tool results before replying.\n' +
      'Code fences or surrounding prose are fine. If that JSON is impractical, you may instead write your reply as prose and ' +
      'express tool calls in any common format (e.g. <tool_call>{"name": ..., "arguments": ...}</tool_call> or [TOOL_CALLS] [...]); ' +
      'these are parsed too, and your prose then becomes the user-facing text.',
  );
  return parts.join('\n\n');
}

/**
 * Build the user message's content parts.
 *
 * - `direct` attachments are emitted as lightweight `attachment_ref`s in
 *   stable id-order; raw bytes are loaded later by the reason step before
 *   hitting the provider adapter.
 * - `summary` attachments are emitted as a text block carrying the
 *   pre-computed summary (and the attachment id, so the agent can call
 *   `ask_attachment` for follow-up questions). Raw bytes are NOT loaded.
 */
function userMessageParts(
  entry: Extract<ChatEntry, { type: 'user-message' }>,
  summaries: Map<string, ThoughtStreamEntry>,
): LlmContentPart[] {
  const parts: LlmContentPart[] = [{ kind: 'text', text: entry.text }];
  const ordered = [...(entry.attachments ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  for (const att of ordered) {
    if (att.mode === 'summary') {
      const summary = summaries.get(att.id);
      const summaryBody = summary?.summaryText?.trim() ?? '[summary unavailable]';
      parts.push({
        kind: 'text',
        text:
          `<attachment_summary id="${att.id}" filename="${att.name}" mime="${att.mimeType}" ` +
          `size_bytes="${att.sizeBytes}">\n${summaryBody}\n</attachment_summary>`,
      });
      continue;
    }
    parts.push({
      kind: 'attachment_ref',
      attachmentId: att.id,
      mime: att.mimeType,
      filename: att.name,
      sizeBytes: att.sizeBytes,
    });
  }
  return parts;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * Render a tool-invocation as the canonical OpenAI-style pair:
 *   assistant{ tool_calls:[{id, name, args}] }
 *   tool     { tool_result{ callId, payload } }
 *
 * The planner currently emits tool requests as text JSON (no native
 * tool_calls in the model output), so we synthesize the assistant turn
 * here using the chat-entry id as a stable callId.
 */
function toolInvocationAsPair(entry: Extract<ChatEntry, { type: 'tool-invocation' }>): LlmMessage[] {
  const callId = entry.id;
  return [
    {
      role: 'assistant',
      parts: [{ kind: 'tool_call', callId, toolName: entry.toolId, args: entry.parameters }],
    },
    {
      role: 'tool',
      parts: [{ kind: 'tool_result', callId, ok: entry.state === 'done', payload: stringify(entry.result) }],
    },
  ];
}

function entryToMessages(
  entry: ChatEntry,
  summaries: Map<string, ThoughtStreamEntry>,
): LlmMessage[] {
  switch (entry.type) {
    case 'user-message':
      return [{ role: 'user', parts: userMessageParts(entry, summaries) }];
    case 'assistant-message':
      return [textMessage('assistant', entry.text)];
    case 'tool-invocation':
      return toolInvocationAsPair(entry);
    case 'checkpoint-summary':
      // Inject the fold as a system-role context note in the order it appears
      // in the chain. The summarized turns themselves live on a sibling
      // branch and are naturally absent from this chain, so the planner
      // sees just this condensed paragraph in their place.
      return [textMessage('system', `[Earlier in this conversation, summarized]\n${entry.summaryText}`)];
    case 'context-injection':
      // Empty when the scan found nothing to inject (mode 'none', or no
      // candidate files matched); the entry is still persisted for the audit
      // trail (`files`), just with no message to contribute here.
      return entry.content.trim().length > 0
        ? [textMessage('system', `[Project context files]\n${entry.content}`)]
        : [];
    case 'thought-prepare':
    case 'thought-action':
    case 'thought_stream':
      return [];
    default: {
      const _exhaustive: never = entry;
      throw new Error(`entryToMessages: unhandled chat entry type ${(_exhaustive as ChatEntry).type}`);
    }
  }
}

export function buildPlannerMessages(input: BuildPlannerMessagesInput): LlmMessage[] {
  const summaries = indexAttachmentSummaries(input.entries);
  const messages: LlmMessage[] = [textMessage('system', plannerSystemContent(input.systemPrompt, input.tools))];
  for (const entry of input.entries) {
    for (const m of entryToMessages(entry, summaries)) messages.push(m);
  }
  // Surface a mid-conversation tool change as a fresh system note after the
  // latest turn — the model otherwise silently receives a different tool list.
  if (input.toolChangeNote) messages.push(textMessage('system', input.toolChangeNote));
  return messages;
}
