import { logger } from "../../infra/logger.js";
import { ChatEntriesRepo } from "../../infra/repositories/chatEntriesRepo.js";
import { ConversationsRepo } from "../../infra/repositories/conversationsRepo.js";
import { LlmProviderSettingsRepo } from "../../infra/repositories/llmProviderSettingsRepo.js";
import { ConversationEventHub } from "../../events/conversationEventHub.js";
import { SseType } from "../../types/sse.js";

type TitleGenerationResult = {
  model: string;
  fullResponse: string;
  cleanTitle: string | null;
  promptTokens?: number;
  completionTokens?: number;
};

type AutoTitleInput = {
  conversations: ConversationsRepo;
  chatEntries: ChatEntriesRepo;
  llmProviderSettings: LlmProviderSettingsRepo;
  hub: ConversationEventHub;
  conversationId: string;
  firstMessage: string;
};

function fallbackConversationTitle(firstMessage: string): string {
  const text = String(firstMessage || "").replace(/\s+/g, " ").trim();
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

async function generateConversationTitleUsingSystemModel(
  llmProviderSettings: LlmProviderSettingsRepo,
  prompt: string,
  onDelta: (delta: string) => void,
): Promise<TitleGenerationResult | null> {
  const doc = llmProviderSettings.getDocument();
  const providerId = String(doc.llm_configuration.provider_id || "").trim();
  const model = String(doc.llm_configuration.model_name || "").trim();
  if (!providerId || !model) return null;
  const provider = llmProviderSettings.getProvider(providerId);
  const providerSettings = llmProviderSettings.getProviderSettings(providerId);
  if (!provider || !providerSettings) return null;
  const completion = await provider.streamTextCompletion(
    providerSettings,
    { model, prompt },
    onDelta,
  );
  const fullResponse = String(completion.text || "");
  const clean = fullResponse
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  return {
    model,
    fullResponse,
    cleanTitle: clean ? (clean.length > 80 ? clean.slice(0, 80).trim() : clean) : null,
    ...(completion.usage
      ? {
          promptTokens: completion.usage.promptTokens,
          completionTokens: completion.usage.completionTokens,
        }
      : {}),
  };
}

export async function maybeAutoTitleConversation({
  conversations,
  chatEntries,
  llmProviderSettings,
  hub,
  conversationId,
  firstMessage,
}: AutoTitleInput): Promise<void> {
  const row = conversations.get(conversationId);
  if (!row) return;
  if (String(row.title || "").trim() !== "New chat") return;
  let generated: TitleGenerationResult | null = null;
  let generationError: unknown = null;
  const startedAtMs = Date.now();
  const titlePrompt = buildTitlePrompt(firstMessage);
  const plannerEntryId = crypto.randomUUID();
  const plannerEntry = chatEntries.appendPlannerLlmStreamEntry(conversationId, {
    id: plannerEntryId,
    createdAt: new Date().toISOString(),
    llmRequest: titlePrompt,
    llmResponse: "",
    thoughtMs: null,
    decision: null,
    failed: false,
  });
  hub.publish(conversationId, {
    type: SseType.PLANNER_STARTING,
    chat_entry_id: plannerEntry.id,
    conversationIndex: plannerEntry.conversationIndex,
    createdAt: plannerEntry.createdAt,
    request_text: titlePrompt,
  });
  let streamedResponse = "";
  try {
    generated = await generateConversationTitleUsingSystemModel(
      llmProviderSettings,
      titlePrompt,
      (delta) => {
        streamedResponse += delta;
        hub.publish(conversationId, {
          type: SseType.PLANNER_LLM_STREAM,
          chat_entry_id: plannerEntry.id,
          delta,
        });
      },
    );
  } catch (e) {
    generationError = e;
    logger.error(
      { conversationId, error: e },
      "[chat] title generation request failed",
    );
  }

  if (generated) {
    chatEntries.updatePlannerLlmStreamEntry(conversationId, {
      id: plannerEntryId,
      llmRequest: titlePrompt,
      llmResponse: generated.fullResponse,
      thoughtMs: Math.max(0, Date.now() - startedAtMs),
      decision: null,
      failed: false,
      llmModel: generated.model,
      ...(generated.promptTokens != null && generated.completionTokens != null
        ? {
            promptTokens: generated.promptTokens,
            completionTokens: generated.completionTokens,
          }
        : {}),
    });
    hub.publish(conversationId, {
      type: SseType.PLANNER_RESPONSE,
      chat_entry_id: plannerEntry.id,
      summary:
        generated.cleanTitle != null
          ? `Generated title: ${generated.cleanTitle}`
          : "Generated title was empty, fallback used",
      finished: true,
      action: generated.cleanTitle != null ? "final_answer" : "failed",
      llm_model: generated.model,
      ...(generated.promptTokens != null && generated.completionTokens != null
        ? {
            prompt_tokens: generated.promptTokens,
            completion_tokens: generated.completionTokens,
          }
        : {}),
    });
  } else if (!generationError) {
    // No provider/model configured for title generation; close the thought row explicitly.
    const detail = "Title generation skipped, fallback used";
    chatEntries.updatePlannerLlmStreamEntry(conversationId, {
      id: plannerEntryId,
      llmRequest: titlePrompt,
      llmResponse: detail,
      thoughtMs: Math.max(0, Date.now() - startedAtMs),
      decision: null,
      failed: true,
    });
    hub.publish(conversationId, {
      type: SseType.PLANNER_RESPONSE,
      chat_entry_id: plannerEntry.id,
      summary: detail,
      finished: true,
      action: "failed",
    });
  }

  const byModel = generated?.cleanTitle ?? null;
  const title = byModel || fallbackConversationTitle(firstMessage);
  const current = conversations.get(conversationId);
  if (!current || String(current.title || "").trim() !== "New chat") return;
  const updated = conversations.updateTitle(conversationId, title);
  if (!updated) return;
  hub.publish(conversationId, {
    type: SseType.CONVERSATION_UPDATED,
    conversation: updated,
  });

  if (generationError) {
    const detail =
      generationError instanceof Error ? generationError.message : String(generationError);
    chatEntries.updatePlannerLlmStreamEntry(conversationId, {
      id: plannerEntryId,
      llmRequest: titlePrompt,
      llmResponse: streamedResponse ? `${streamedResponse}\n${detail}` : detail,
      thoughtMs: Math.max(0, Date.now() - startedAtMs),
      decision: null,
      failed: true,
    });
    if (detail) {
      hub.publish(conversationId, {
        type: SseType.PLANNER_LLM_STREAM,
        chat_entry_id: plannerEntry.id,
        delta: detail,
      });
    }
    hub.publish(conversationId, {
      type: SseType.PLANNER_RESPONSE,
      chat_entry_id: plannerEntry.id,
      summary: "Title generation failed, fallback used",
      finished: true,
      action: "failed",
    });
  }
}
