import { logger } from "../../infra/logger.js";
import { ChatEntriesRepo } from "../../infra/repositories/chatEntriesRepo.js";
import { ConversationsRepo } from "../../infra/repositories/conversationsRepo.js";
import { LlmProviderSettingsRepo } from "../../infra/repositories/llmProviderSettingsRepo.js";
import { ConversationEventHub } from "../../events/conversationEventHub.js";
import { SseType } from "../../types/sse.js";

type TitleGenerationResult = {
  model: string;
  prompt: string;
  rawResponse: string;
  cleanTitle: string | null;
  promptTokens?: number;
  completionTokens?: number;
};

type CreateAutoTitleHandlerInput = {
  conversations: ConversationsRepo;
  chatEntries: ChatEntriesRepo;
  llmProviderSettings: LlmProviderSettingsRepo;
  hub: ConversationEventHub;
};

function fallbackConversationTitle(firstMessage: string): string {
  const text = String(firstMessage || "").replace(/\s+/g, " ").trim();
  if (!text) return "New chat";
  return text.length > 64 ? `${text.slice(0, 64).trim()}...` : text;
}

export function createAutoTitleHandler({
  conversations,
  chatEntries,
  llmProviderSettings,
  hub,
}: CreateAutoTitleHandlerInput): (conversationId: string, firstMessage: string) => void {
  async function generateConversationTitleUsingSystemModel(
    firstMessage: string,
  ): Promise<TitleGenerationResult | null> {
    const doc = llmProviderSettings.getDocument();
    const providerId = String(doc.llm_configuration.provider_id || "").trim();
    const model = String(doc.llm_configuration.model_name || "").trim();
    if (!providerId || !model) return null;
    const provider = llmProviderSettings.getProvider(providerId);
    const providerSettings = llmProviderSettings.getProviderSettings(providerId);
    if (!provider || !providerSettings) return null;
    const prompt =
      "Generate a short conversation title (3-6 words max). " +
      "Return plain text only, no quotes, no punctuation at the end.\n\n" +
      `First message: ${firstMessage}`;
    const completion = await provider.streamTextCompletion(
      providerSettings,
      { model, prompt },
      () => {},
    );
    const rawResponse = String(completion.text || "");
    const clean = rawResponse
      .replace(/\s+/g, " ")
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();
    return {
      model,
      prompt,
      rawResponse,
      cleanTitle: clean ? (clean.length > 80 ? clean.slice(0, 80).trim() : clean) : null,
      ...(completion.usage
        ? {
            promptTokens: completion.usage.promptTokens,
            completionTokens: completion.usage.completionTokens,
          }
        : {}),
    };
  }

  return (conversationId: string, firstMessage: string): void => {
    const row = conversations.get(conversationId);
    if (!row) return;
    if (String(row.title || "").trim() !== "New chat") return;
    void (async () => {
      let generated: TitleGenerationResult | null = null;
      let generationError: unknown = null;
      const startedAtMs = Date.now();
      try {
        generated = await generateConversationTitleUsingSystemModel(firstMessage);
      } catch (e) {
        generationError = e;
        logger.error(
          { conversationId, error: e },
          "[chat] title generation request failed",
        );
      }

      if (generated) {
        const plannerEntryId = crypto.randomUUID();
        const plannerEntry = chatEntries.appendPlannerLlmStreamEntry(conversationId, {
          id: plannerEntryId,
          createdAt: new Date().toISOString(),
          llmRequest: generated.prompt,
          llmResponse: generated.rawResponse,
          thoughtMs: Math.max(0, Date.now() - startedAtMs),
          decision: null,
          failed: false,
          llmModel: generated.model,
        });
        chatEntries.updatePlannerLlmStreamEntry(conversationId, {
          id: plannerEntryId,
          llmRequest: generated.prompt,
          llmResponse: generated.rawResponse,
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
          type: SseType.PLANNER_STARTING,
          chat_entry_id: plannerEntry.id,
          conversationIndex: plannerEntry.conversationIndex,
          createdAt: plannerEntry.createdAt,
          request_text: generated.prompt,
          llm_model: generated.model,
        });
        if (generated.rawResponse) {
          hub.publish(conversationId, {
            type: SseType.PLANNER_LLM_STREAM,
            chat_entry_id: plannerEntry.id,
            delta: generated.rawResponse,
          });
        }
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
        const plannerEntryId = crypto.randomUUID();
        const detail =
          generationError instanceof Error ? generationError.message : String(generationError);
        const plannerEntry = chatEntries.appendPlannerLlmStreamEntry(conversationId, {
          id: plannerEntryId,
          createdAt: new Date().toISOString(),
          llmRequest:
            "Generate a short conversation title (3-6 words max). Return plain text only.",
          llmResponse: detail,
          thoughtMs: Math.max(0, Date.now() - startedAtMs),
          decision: null,
          failed: true,
        });
        hub.publish(conversationId, {
          type: SseType.PLANNER_STARTING,
          chat_entry_id: plannerEntry.id,
          conversationIndex: plannerEntry.conversationIndex,
          createdAt: plannerEntry.createdAt,
          request_text: plannerEntry.llmRequest,
        });
        hub.publish(conversationId, {
          type: SseType.PLANNER_LLM_STREAM,
          chat_entry_id: plannerEntry.id,
          delta: detail,
        });
        hub.publish(conversationId, {
          type: SseType.PLANNER_RESPONSE,
          chat_entry_id: plannerEntry.id,
          summary: "Title generation failed, fallback used",
          finished: true,
          action: "failed",
        });
      }
    })();
  };
}
