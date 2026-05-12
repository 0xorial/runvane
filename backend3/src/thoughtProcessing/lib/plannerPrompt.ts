import type { ChatEntry } from '../../contracts/chatEntry.js';

export type PriorToolResult = {
  toolId: string;
  ok: boolean;
  output: unknown;
  error: string | null;
};

export type BuildPlannerPromptInput = {
  systemPrompt: string;
  entries: ChatEntry[];
  anchorUserText: string;
  triggerEntry: ChatEntry | null;
  toolIds: string[];
  priorToolResults: PriorToolResult[];
};

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  const serialized = JSON.stringify(value);
  return typeof serialized === 'string' ? serialized : String(serialized);
}

function summarizeEntry(entry: ChatEntry): string {
  switch (entry.type) {
    case 'user-message': {
      const attachments = entry.attachments ?? [];
      if (attachments.length === 0) return `USER: ${entry.text}`;
      const summary = attachments.map((a) => `${a.name} (${a.mimeType}, ${a.sizeBytes}b)`).join(', ');
      return `USER: ${entry.text}\nATTACHMENTS: ${summary}`;
    }
    case 'assistant-message':
      return `ASSISTANT: ${entry.text}`;
    case 'planner_llm_stream':
      return `THINKING: ${entry.llmResponse ?? ''}`;
    case 'title_llm_stream':
      return `TITLE_THINKING: ${entry.llmResponse ?? ''}`;
    case 'tool_params_llm_stream':
      return `TOOL_PARAMS_THINKING: ${entry.llmResponse ?? ''}`;
    case 'thought-prepare':
      return `PREPARE_REQUEST: ${entry.requestText}`;
    case 'thought-action':
      return `TAKE_ACTION: status=${entry.status} action=${entry.action ?? ''} summary=${entry.summary ?? ''} error=${entry.error ?? ''}`;
    case 'tool-invocation':
      return `TOOL: id=${entry.toolId} state=${entry.state} parameters=${stringify(entry.parameters)} result=${stringify(entry.result)}`;
    default: {
      const exhaustive: never = entry;
      throw new Error(`summarizeEntry: unhandled chat entry type ${(exhaustive as ChatEntry).type}`);
    }
  }
}

function toolsBlock(toolIds: string[]): string {
  if (toolIds.length === 0) return '';
  const list = toolIds.map((id, idx) => `${idx + 1}. ${id}`).join('\n');
  return `<TOOLS>
Allowed tool IDs for this run:
${list}

Tooling is available in runtime, but tool schemas are not included in this prompt.
When you need a tool, specify:
- tool_name
- request (plain-language intent that another tool-parameter LLM can convert into exact JSON args)

Return ONLY valid JSON with this exact shape:
{"assistant_output":"string optional","tool_requests":[{"tool_name":"<tool_name>","request":"what you need tool to do"}],"followup":"finalize|continue"}

Rules:
- Use tool_name/toolId only from the allowed tool IDs listed above.
- Planner MUST NOT output tool parameters.
- If no tools are needed, return empty tool_requests and followup="finalize".
- If tools are needed, use tool_requests with tool_name + natural-language request.
- If tools should run and conversation should resume after results, use followup="continue".
- Keep assistant_output as user-facing text for this step.
</TOOLS>

`;
}

function priorToolResultsBlock(rows: PriorToolResult[]): string {
  if (rows.length === 0) return '';
  const lines = rows
    .map(
      (row, idx) => `${idx + 1}. tool=${row.toolId} ok=${row.ok} output=${stringify(row.output)} error=${row.error ?? ''}`,
    )
    .join('\n');
  return `<PRIOR_TOOL_RESULTS>\n${lines}\n</PRIOR_TOOL_RESULTS>\n\n`;
}

function triggerEntryBlock(entry: ChatEntry | null): string {
  if (!entry) return '';
  return `<TRIGGER_ENTRY>\n${summarizeEntry(entry)}\n</TRIGGER_ENTRY>\n\n`;
}

function systemBlock(systemPrompt: string): string {
  if (!systemPrompt) return '';
  return `<SYSTEM_PROMPT>\n${systemPrompt}\n</SYSTEM_PROMPT>\n\n`;
}

export function buildPlannerPrompt(input: BuildPlannerPromptInput): string {
  const summary = input.entries.map((entry, idx) => `${idx + 1}. ${summarizeEntry(entry)}`).join('\n');
  return (
    systemBlock(input.systemPrompt) +
    toolsBlock(input.toolIds) +
    priorToolResultsBlock(input.priorToolResults) +
    triggerEntryBlock(input.triggerEntry) +
    `<CONVERSATION_SUMMARY>\n${summary}\n</CONVERSATION_SUMMARY>\n\n` +
    `<ANCHOR_USER_MESSAGE>\n${input.anchorUserText}\n</ANCHOR_USER_MESSAGE>\n\n` +
    "Provide best possible answer to user's question. Use tools if necessary."
  );
}
