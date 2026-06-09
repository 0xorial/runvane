import type { ChatEntry } from '../../contracts/chatEntry.js';
import { textMessage, type LlmMessage } from '../../llmProviders/types.js';

export type BuildToolParamsMessagesInput = {
  toolName: string;
  toolAiDescription: string;
  toolParamsSchema: unknown;
  toolRequest: string;
  paramsContextNote?: string;
};

export function buildAskAttachmentParamsContext(entries: ChatEntry[]): string | undefined {
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.type !== 'user-message') continue;
    for (const attachment of entry.attachments ?? []) {
      lines.push(`${attachment.id} (${attachment.name}, ${attachment.mode})`);
    }
  }
  if (lines.length === 0) return undefined;
  return `Attachments in this conversation — set attachment_id to one of:\n${lines.map((line) => `- ${line}`).join('\n')}`;
}

export function buildToolParamsMessages(input: BuildToolParamsMessagesInput): LlmMessage[] {
  const system =
    `Produce JSON args for tool "${input.toolName}".\n` +
    `Reply with ONE JSON object whose top-level keys are the schema fields. ` +
    `Do NOT wrap under the tool name. Do NOT add prose or code fences. ` +
    `If the schema has no fields, reply with {}.\n` +
    `Description: ${input.toolAiDescription}\n` +
    `Schema: ${JSON.stringify(input.toolParamsSchema)}`;
  const userText = input.paramsContextNote
    ? `${input.paramsContextNote}\n\nPlanner request: ${input.toolRequest}`
    : input.toolRequest;
  return [textMessage('system', system), textMessage('user', userText)];
}

/**
 * Parse the LLM's tool-args JSON. LLMs frequently wrap args under the tool
 * name (`{"<toolName>": {...}}`) despite explicit instructions; unwrap that
 * single well-known shape rather than failing the call.
 */
export function parseToolParamsJson(text: string, toolName: string, context: string): Record<string, unknown> {
  const stripped = String(text ?? '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsed = JSON.parse(stripped);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${context}: expected JSON object`);
  }
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (
    keys.length === 1 &&
    keys[0] === toolName &&
    obj[toolName] !== null &&
    typeof obj[toolName] === 'object' &&
    !Array.isArray(obj[toolName])
  ) {
    return obj[toolName] as Record<string, unknown>;
  }
  return obj;
}
