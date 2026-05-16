import type { ChatEntry } from '../../contracts/chatEntry.js';
import { textMessage, type LlmContentPart, type LlmMessage } from '../../llmProviders/types.js';

export type BuildPlannerMessagesInput = {
  systemPrompt: string;
  entries: ChatEntry[];
  toolIds: string[];
};

function plannerSystemContent(agentSystemPrompt: string, toolIds: string[]): string {
  const parts: string[] = [];
  if (agentSystemPrompt.trim().length > 0) parts.push(agentSystemPrompt.trim());
  parts.push(toolIds.length > 0 ? `Tools: ${toolIds.join(', ')}` : 'Tools: (none)');
  parts.push(
    'Reply with one JSON object, no markedown, no prose:\n' +
      '{"assistant_thinking": string, "assistant_output": string, "tool_requests": [{"tool_name": string, "tool_request": string}], "followup": "finalize"|"continue"}\n' +
      '`assistant_thinking` is a brief summary of your thoughts and plans for the next step. ' +
      '`assistant_output` is the user-facing text of your response. ' +
      '`tool_requests` is an array of tool requests. ' +
      '`followup` is the mode for the next step: "finalize" if you need to finalize the conversation, "continue" if you need to continue the conversation. ' +
      '`tool_request` is a natural-language brief; a separate agent will fills the JSON args. ' +
      'Use "continue" only if you need tool results before replying.',
  );
  return parts.join('\n\n');
}

/**
 * Build the user message's content parts. Attachments are emitted as
 * lightweight `attachment_ref`s in stable id-order; raw bytes are loaded
 * later by the reason step before hitting the provider adapter.
 */
function userMessageParts(entry: Extract<ChatEntry, { type: 'user-message' }>): LlmContentPart[] {
  const parts: LlmContentPart[] = [{ kind: 'text', text: entry.text }];
  const ordered = [...(entry.attachments ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  for (const att of ordered) {
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

function entryToMessages(entry: ChatEntry): LlmMessage[] {
  switch (entry.type) {
    case 'user-message':
      return [{ role: 'user', parts: userMessageParts(entry) }];
    case 'assistant-message':
      return [textMessage('assistant', entry.text)];
    case 'tool-invocation':
      return toolInvocationAsPair(entry);
    case 'thought-prepare':
    case 'thought-action':
    case 'planner_llm_stream':
    case 'title_llm_stream':
    case 'tool_params_llm_stream':
      return [];
    default: {
      const _exhaustive: never = entry;
      throw new Error(`entryToMessages: unhandled chat entry type ${(_exhaustive as ChatEntry).type}`);
    }
  }
}

export function buildPlannerMessages(input: BuildPlannerMessagesInput): LlmMessage[] {
  const messages: LlmMessage[] = [textMessage('system', plannerSystemContent(input.systemPrompt, input.toolIds))];
  for (const entry of input.entries) {
    for (const m of entryToMessages(entry)) messages.push(m);
  }
  return messages;
}
