import { usageByConversationId } from "../../conversationUsage.js";
import { finishThoughtLifecycle } from "../../thoughtLifecycle.js";
import type { ChatEntriesRepo } from "../../../infra/repositories/chatEntriesRepo.js";
import type { ConversationsRepo } from "../../../infra/repositories/conversationsRepo.js";
import type { ConversationEventHub } from "../../../events/conversationEventHub.js";
import { SseType } from "../../../types/sse.js";
import type { ThoughtExecution, ThoughtTypeProvider, ThoughtReasonLlmResult } from "../types.js";

export type AutoTitleThought = ThoughtExecution & {
  thoughtType: "autoTitle";
  conversationId: string;
  streamEntryId: string;
  thoughtActionEntryId?: string;
};

export type AutoTitlePrepareSeed = {
  firstMessage: string;
};

export type AutoTitlePrepareOutput = {
  conversationId: string;
  streamEntryId: string;
  titlePrompt: string;
  fallbackTitle: string;
};

export type AutoTitleReasonOutput = {
  conversationId: string;
  streamEntryId: string;
  thoughtActionEntryId: string | null;
  prompt: string;
  requestStartedMs: number;
  result?: ThoughtReasonLlmResult;
  fallbackTitle: string;
};

export type AutoTitleThoughtTypeProviderDeps = {
  conversations: ConversationsRepo;
  chatEntries: ChatEntriesRepo;
  hub: ConversationEventHub;
};

export function createAutoTitleThoughtTypeProvider(
  deps: AutoTitleThoughtTypeProviderDeps
): ThoughtTypeProvider<AutoTitlePrepareSeed, AutoTitlePrepareOutput, AutoTitleReasonOutput, AutoTitleThought> {
  return {
    runPrepare: async (_step, input) => ({
      thought: input.thought,
      prepareOutput: {
        conversationId: input.thought.conversationId,
        streamEntryId: input.thought.streamEntryId,
        titlePrompt: buildTitlePrompt(input.seed.firstMessage),
        fallbackTitle: fallbackConversationTitle(input.seed.firstMessage),
      },
    }),
    runReason: async (_step, input) => ({
      thought: input.thought,
      reasonOutput: {
        conversationId: input.prepareOutput.conversationId,
        streamEntryId: input.prepareOutput.streamEntryId,
        thoughtActionEntryId: input.thought.thoughtActionEntryId ?? null,
        prompt: input.prepareOutput.titlePrompt,
        requestStartedMs: Date.now(),
        fallbackTitle: input.prepareOutput.fallbackTitle,
      },
    }),
    runDecision: async (_step, input) => {
      const result = input.reasonOutput;
      if (!result.result) {
        throw new Error("autoTitle decision requires runtime-provided LLM result");
      }
      const cleanTitle = normalizeGeneratedTitle(result.result.fullResponse);
      const current = deps.conversations.get(result.conversationId);
      const nextTitle = cleanTitle ?? result.fallbackTitle;
      const summary = cleanTitle ? `Generated title: ${cleanTitle}` : "Generated title was empty, fallback used";
      finishThoughtLifecycle(
        { chatEntries: deps.chatEntries, hub: deps.hub },
        {
          conversationId: result.conversationId,
          kind: "title",
          streamEntryId: result.streamEntryId,
          thoughtActionEntryId: result.thoughtActionEntryId,
          llmRequest: result.prompt,
          llmResponse: result.result.fullResponse,
          thoughtMs: Math.max(0, Date.now() - result.requestStartedMs),
          decision: null,
          status: cleanTitle ? "completed" : "failed",
          ...(cleanTitle ? {} : { error: summary }),
          llmProviderId: result.result.providerId,
          llmModel: result.result.model,
          usage: result.result.usage,
          summary,
          action: cleanTitle ? "final_answer" : "failed",
        }
      );
      if (!current || String(current.title || "").trim() !== "New chat") return;
      const updated = deps.conversations.updateTitle(result.conversationId, nextTitle);
      if (!updated) return;
      deps.hub.publish(result.conversationId, {
        type: SseType.CONVERSATION_UPDATED,
        conversation: {
          id: updated.id,
          title: updated.title,
          groupId: updated.group_id,
          isDeleted: Number(updated.is_deleted ?? 0) === 1,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
          lastMessageAt: updated.last_message_at || updated.created_at,
          promptTokensTotal: updated.prompt_tokens_total,
          cachedPromptTokensTotal: updated.cached_prompt_tokens_total,
          completionTokensTotal: updated.completion_tokens_total,
          tokenUsageByModel:
            usageByConversationId(deps.chatEntries.listConversationTokenUsageByModel()).get(result.conversationId) ??
            [],
        },
      });
    },
    getReasonLlmRequest: (input) => ({ prompt: input.reasonOutput.prompt }),
    onReasonLlmDelta: (input, delta) => {
      deps.hub.publish(input.reasonOutput.conversationId, {
        type: SseType.TITLE_LLM_STREAM,
        chatEntryId: input.reasonOutput.streamEntryId,
        delta,
      });
    },
    applyReasonLlmResult: (input, result) => ({
      ...input,
      reasonOutput: {
        ...input.reasonOutput,
        result,
      },
    }),
    getLifecycleStartRequest: (input) => ({
      conversationId: input.thought.conversationId,
      llmRequest: input.seed.firstMessage,
      kind: "title",
      includeAction: true,
      summary: "Title generation",
    }),
    applyLifecycleStart: (input, started) => ({
      ...input,
      thought: {
        ...input.thought,
        thoughtId: started.thoughtId,
        streamEntryId: started.streamEntryId,
        ...(started.thoughtActionEntryId ? { thoughtActionEntryId: started.thoughtActionEntryId } : {}),
      },
    }),
  };
}

function fallbackConversationTitle(firstMessage: string): string {
  const text = String(firstMessage || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "New chat";
  return text.length > 64 ? `${text.slice(0, 64).trim()}...` : text;
}

function buildTitlePrompt(firstMessage: string): string {
  return (
    "Generate a short conversation title (3-6 words max). " +
    "Return plain text only, no quotes, no punctuation at the end.\n\n" +
    `First message: ${firstMessage}`
  );
}

function normalizeGeneratedTitle(fullResponse: string): string | null {
  const clean = fullResponse
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  if (!clean) return null;
  const bounded = clean.length > 80 ? clean.slice(0, 80).trim() : clean;
  if (!bounded) return null;
  if (!/[a-z0-9]/i.test(bounded)) return null;
  if (/^[\s{}[\],:"'`]+$/.test(bounded)) return null;
  return bounded;
}
