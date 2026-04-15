import type {
  AgenticPlannerOutput,
  ChatEntry,
  LlmDecision,
  LlmDecisionUserResponse,
} from "../types/chatEntry.js";
import { AgenticPlannerOutputSchema } from "../types/chatEntry.js";
import {
  extractAssistantOutputFromJsonLike,
  extractLastBalancedJsonObject,
  parseFirstJsonObjectCandidate,
} from "./continueConversationTaskProcessor.helpers.js";

export type PriorToolResult = {
  toolId: string;
  ok: boolean;
  output: unknown;
  error: string | null;
};

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  const serialized = JSON.stringify(value);
  return typeof serialized === "string" ? serialized : String(serialized);
}

function summarizeEntry(entry: ChatEntry): string {
  if (entry.type === "user-message") {
    const attachments = entry.attachments ?? [];
    if (attachments.length === 0) return `USER: ${entry.text}`;
    const attachmentSummary = attachments.map((a) => `${a.name} (${a.mimeType}, ${a.sizeBytes}b)`).join(", ");
    return `USER: ${entry.text}\nATTACHMENTS: ${attachmentSummary}`;
  }
  if (entry.type === "assistant-message") {
    return `ASSISTANT: ${entry.text}`;
  }
  if (entry.type === "planner_llm_stream") {
    const response = entry.llmResponse ?? "";
    return `THINKING: ${response}`;
  }
  if (entry.type === "title_llm_stream") {
    const response = entry.llmResponse ?? "";
    return `TITLE_THINKING: ${response}`;
  }
  const parameters = stringify(entry.parameters);
  const result = stringify(entry.result);
  return `TOOL: id=${entry.toolId} state=${entry.state} parameters=${parameters} result=${result}`;
}

export function buildPlannerPrompt(input: {
  systemPrompt: string;
  entries: ChatEntry[];
  anchorUserText: string;
  triggerEntry: ChatEntry | null;
  toolIds: string[];
  priorToolResults: PriorToolResult[];
}): string {
  const summaryLines = input.entries.map((entry, idx) => `${idx + 1}. ${summarizeEntry(entry)}`);
  const summary = summaryLines.join("\n");
  const systemBlock = input.systemPrompt
    ? `<SYSTEM_PROMPT>\n${input.systemPrompt}\n</SYSTEM_PROMPT>\n\n`
    : "";
  const toolsBlock =
    input.toolIds.length > 0
      ? `<TOOLS>
Allowed tool IDs for this run:
${input.toolIds.map((toolId, idx) => `${idx + 1}. ${toolId}`).join("\n")}

Tooling is available in runtime, but tool schemas are not included in this prompt.
When you need a tool, specify:
- tool_name
- request (plain-language intent that another tool-parameter LLM can convert into exact JSON args)

Return ONLY valid JSON with this exact shape:
{"assistant_output":"string optional","tool_requests":[{"tool_name":"<tool_name>","request":"what you need tool to do"}],"followup":"finalize|continue_with_results|retry_with_adjustment","state":{}}

Rules:
- Use tool_name/toolId only from the allowed tool IDs listed above.
- Planner MUST NOT output tool parameters.
- If no tools are needed, return empty tool_requests and followup="finalize".
- If tools are needed, use tool_requests with tool_name + natural-language request.
- If prior tool errors exist and you need another attempt, use followup="retry_with_adjustment".
- Keep assistant_output as user-facing text for this step.
</TOOLS>

`
      : "";
  const priorToolResultsBlock =
    input.priorToolResults.length > 0
      ? `<PRIOR_TOOL_RESULTS>
${input.priorToolResults
  .map(
    (row, idx) =>
      `${idx + 1}. tool=${row.toolId} ok=${row.ok} output=${stringify(row.output)} error=${row.error ?? ""}`,
  )
  .join("\n")}
</PRIOR_TOOL_RESULTS>

`
      : "";
  const triggerEntryBlock = input.triggerEntry
    ? `<TRIGGER_ENTRY>
${summarizeEntry(input.triggerEntry)}
</TRIGGER_ENTRY>

`
    : "";

  return (
    `${systemBlock}` +
    toolsBlock +
    priorToolResultsBlock +
    triggerEntryBlock +
    `<CONVERSATION_SUMMARY>\n${summary}\n</CONVERSATION_SUMMARY>\n\n` +
    `<ANCHOR_USER_MESSAGE>\n${input.anchorUserText}\n</ANCHOR_USER_MESSAGE>\n\n` +
    "Provide best possible answer to user's question. Use tools if necessary."
  );
}

export function parseAgenticPlannerOutput(input: {
  reply: string;
  streamedAnswer: string;
  isToolAvailable: (toolId: string) => boolean;
}): {
  output: AgenticPlannerOutput;
  decision: LlmDecision;
} {
  const cleaned = input.reply.trim();
  const withoutFence = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = parseFirstJsonObjectCandidate([withoutFence, extractLastBalancedJsonObject(withoutFence)]);
  const assistantFallback = input.streamedAnswer || extractAssistantOutputFromJsonLike(input.reply) || "";
  const parsedAgentic = AgenticPlannerOutputSchema.safeParse(parsed);
  if (parsedAgentic.success) {
    const normalizedToolCalls = parsedAgentic.data.tool_calls.filter((call) => input.isToolAvailable(call.toolId));
    if (normalizedToolCalls.length > 0) {
      throw new Error("planner returned tool_calls, but only tool_requests are supported");
    }
    const normalizedToolRequests = parsedAgentic.data.tool_requests
      .map((row) => ({
        tool_name: String(row.tool_name ?? "").trim(),
        request: String(row.request ?? "").trim(),
      }))
      .filter((row) => row.tool_name.length > 0 && row.request.length > 0 && input.isToolAvailable(row.tool_name));
    const output: AgenticPlannerOutput = {
      ...parsedAgentic.data,
      tool_calls: [],
      tool_requests: normalizedToolRequests,
      ...(parsedAgentic.data.assistant_output == null ? { assistant_output: assistantFallback } : {}),
    };
    const decision: LlmDecision =
      normalizedToolRequests.length > 0
        ? ({
            type: "tool-invocation",
            toolId: normalizedToolRequests[0]?.tool_name ?? "unknown_tool",
            parameters: {},
          } as const)
        : ({
            type: "user-response",
            text: String(output.assistant_output ?? "").trim() || input.reply,
          } satisfies LlmDecisionUserResponse);
    return { output, decision };
  }
  const fallbackOutput: AgenticPlannerOutput = {
    assistant_output: assistantFallback || input.reply,
    tool_calls: [],
    tool_requests: [],
    followup: "finalize",
  };
  return {
    output: fallbackOutput,
    decision: {
      type: "user-response",
      text: String(fallbackOutput.assistant_output ?? "").trim() || input.reply,
    } satisfies LlmDecisionUserResponse,
  };
}
