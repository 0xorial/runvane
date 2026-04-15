import type {
  AgenticPlannerOutput,
  ChatEntry,
  LlmDecision,
  LlmDecisionTool,
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
  loopState: Record<string, unknown>;
}): string {
  const summaryLines = input.entries.map((entry, idx) => {
    return `${idx + 1}. ${summarizeEntry(entry)}`;
  });
  const summary = summaryLines.join("\n");
  const systemBlock = input.systemPrompt ? `<SYSTEM_PROMPT>\n${input.systemPrompt}\n</SYSTEM_PROMPT>\n\n` : "";
  return (
    `${systemBlock}` +
    (input.toolIds.length > 0
      ? `<TOOLS>\n${input.toolIds
          .map((line, idx) => `${idx + 1}. ${line}`)
          .join(
            "\n",
          )}\n\nReturn ONLY valid JSON with this exact shape:\n{\"assistant_output\":\"string optional\",\"tool_calls\":[{\"toolId\":\"<tool_name>\",\"parameters\":{}}],\"followup\":\"finalize|continue_with_results|retry_with_adjustment\",\"state\":{}}\n\nRules:\n- Use tool IDs from <TOOLS> only.\n- If no tools are needed, return empty tool_calls and followup=\"finalize\".\n- If tools are needed, include all calls for this step in tool_calls.\n- If prior tool errors exist and you need another attempt, use followup=\"retry_with_adjustment\".\n- Keep assistant_output as user-facing text for this step.\n</TOOLS>\n\n`
      : "") +
    (input.priorToolResults.length > 0
      ? `<PRIOR_TOOL_RESULTS>\n${input.priorToolResults
          .map(
            (row, idx) =>
              `${idx + 1}. tool=${row.toolId} ok=${row.ok} output=${stringify(row.output)} error=${row.error ?? ""}`,
          )
          .join("\n")}\n</PRIOR_TOOL_RESULTS>\n\n`
      : "") +
    (Object.keys(input.loopState).length > 0 ? `<LOOP_STATE>\n${stringify(input.loopState)}\n</LOOP_STATE>\n\n` : "") +
    (input.triggerEntry ? `<TRIGGER_ENTRY>\n${summarizeEntry(input.triggerEntry)}\n</TRIGGER_ENTRY>\n\n` : "") +
    `<CONVERSATION_SUMMARY>\n${summary}\n</CONVERSATION_SUMMARY>\n\n` +
    `<ANCHOR_USER_MESSAGE>\n${input.anchorUserText}\n</ANCHOR_USER_MESSAGE>\n\n` +
    "Provide best possible answer to user's question. Use tools if necessary."
  );
}

function parseLegacyDecision(
  reply: string,
  isToolAvailable: (toolId: string) => boolean,
): LlmDecisionUserResponse | LlmDecisionTool {
  const cleaned = reply.trim();
  const withoutFence = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const assistantFallback = extractAssistantOutputFromJsonLike(reply).trim();
  const parsed = parseFirstJsonObjectCandidate([withoutFence, extractLastBalancedJsonObject(withoutFence)]);
  if (parsed === null) {
    return {
      type: "user-response",
      text: assistantFallback || reply,
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { type: "user-response", text: assistantFallback || reply };
  }
  const rec = parsed as Record<string, unknown>;
  if (rec.type === "user-response") {
    const text = typeof rec.text === "string" ? rec.text.trim() : "";
    return {
      type: "user-response",
      text: text || assistantFallback || reply,
    };
  }
  if (rec.type !== "tool-invocation") {
    return { type: "user-response", text: assistantFallback || reply };
  }
  const toolId = typeof rec.toolId === "string" ? rec.toolId.trim() : "";
  const parameters =
    rec.parameters && typeof rec.parameters === "object" && !Array.isArray(rec.parameters)
      ? (rec.parameters as Record<string, unknown>)
      : {};
  if (!toolId || !isToolAvailable(toolId)) {
    return { type: "user-response", text: assistantFallback || reply };
  }
  return {
    type: "tool-invocation",
    toolId,
    parameters,
  };
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
    const output: AgenticPlannerOutput = {
      ...parsedAgentic.data,
      tool_calls: normalizedToolCalls,
      ...(parsedAgentic.data.assistant_output == null ? { assistant_output: assistantFallback } : {}),
    };
    const decision: LlmDecision =
      normalizedToolCalls.length > 0
        ? ({
            type: "tool-invocation",
            toolId: normalizedToolCalls[0].toolId,
            parameters: normalizedToolCalls[0].parameters,
          } satisfies LlmDecisionTool)
        : ({
            type: "user-response",
            text: String(output.assistant_output ?? "").trim() || input.reply,
          } satisfies LlmDecisionUserResponse);
    return { output, decision };
  }
  const fallbackDecision = parseLegacyDecision(input.reply, input.isToolAvailable);
  const fallbackOutput: AgenticPlannerOutput = {
    assistant_output: fallbackDecision.type === "user-response" ? fallbackDecision.text : assistantFallback,
    tool_calls:
      fallbackDecision.type === "tool-invocation"
        ? [
            {
              toolId: fallbackDecision.toolId,
              parameters: fallbackDecision.parameters,
            },
          ]
        : [],
    followup: fallbackDecision.type === "tool-invocation" ? "continue_with_results" : "finalize",
  };
  return { output: fallbackOutput, decision: fallbackDecision };
}
