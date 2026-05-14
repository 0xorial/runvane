import type { ChatEntry } from '../../contracts/chatEntry.js';
import { textMessage, type LlmMessage } from '../../llmProviders/types.js';

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
    'Reply with one JSON object, no prose:\n' +
      '{"assistant_output": string, "tool_requests": [{"tool_name": string, "tool_request": string}], "followup": "finalize"|"continue"}\n' +
      '`tool_request` is a natural-language brief; a separate step fills the JSON args. ' +
      'Use "continue" only if you need tool results before replying.',
  );
  return parts.join('\n\n');
}

function userContentFromEntry(entry: Extract<ChatEntry, { type: 'user-message' }>): string {
  const attachments = entry.attachments ?? [];
  if (attachments.length === 0) return entry.text;
  const summary = attachments.map((a) => `${a.name} (${a.mimeType}, ${a.sizeBytes}b)`).join(', ');
  return `${entry.text}\n[attachments: ${summary}]`;
}

/**
 * Render a tool-invocation as the canonical OpenAI-style pair:
 *   assistant{ tool_calls:[{id, name, args}] }
 *   tool     { tool_result{ callId, payload } }
 *
 * The planner currently emits tool requests as text JSON (no native
 * tool_calls in the model output), so we synthesize the assistant turn
 * here using the chat-entry id as a stable callId. Adapters that don't
 * support native tools fall back to text via their own translation.
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
      parts: [{ kind: 'tool_result', callId, ok: entry.state === 'done', payload: entry.result }],
    },
  ];
}

function entryToMessages(entry: ChatEntry): LlmMessage[] {
  switch (entry.type) {
    case 'user-message':
      return [textMessage('user', userContentFromEntry(entry))];
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
