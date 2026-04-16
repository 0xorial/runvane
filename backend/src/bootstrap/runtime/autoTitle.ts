import { logger } from "../../infra/logger.js";
import { ChatEntriesRepo } from "../../infra/repositories/chatEntriesRepo.js";
import { ConversationsRepo } from "../../infra/repositories/conversationsRepo.js";
import { LlmProviderSettingsRepo } from "../../infra/repositories/llmProviderSettingsRepo.js";
import { ConversationEventHub } from "../../events/conversationEventHub.js";
import { SseType } from "../../types/sse.js";
import type { StreamTextCompletionUsage } from "../../llm_provider/provider.js";
import { TokenUsageMapper } from "../../types/tokenUsage.js";
import { normalizeConversationTokenUsageRow } from "../../domain/conversationUsage.js";

type TitleGenerationResult = {
  model: string;
  fullResponse: string;
  cleanTitle: string | null;
  usage?: StreamTextCompletionUsage;
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
  const completion = await provider.streamTextCompletion(providerSettings, { model, prompt }, onDelta);
  const fullResponse = String(completion.text || "");
  const clean = normalizeGeneratedTitle(fullResponse);
  return {
    model,
    fullResponse,
    cleanTitle: clean,
    ...(completion.usage ? { usage: completion.usage } : {}),
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
  const plannerEntry = chatEntries.appendTitleLlmStreamEntry(conversationId, {
    id: plannerEntryId,
    createdAt: new Date().toISOString(),
    llmRequest: titlePrompt,
    llmResponse: "",
    thoughtMs: null,
    decision: null,
    status: "running",
  });
  hub.publish(conversationId, {
    type: SseType.TITLE_STARTING,
    chatEntryId: plannerEntry.id,
    conversationIndex: plannerEntry.conversationIndex,
    createdAt: plannerEntry.createdAt,
    requestText: titlePrompt,
  });
  let streamedResponse = "";
  try {
    generated = await generateConversationTitleUsingSystemModel(llmProviderSettings, titlePrompt, (delta) => {
      streamedResponse += delta;
      hub.publish(conversationId, {
        type: SseType.TITLE_LLM_STREAM,
        chatEntryId: plannerEntry.id,
        delta,
      });
    });
  } catch (e) {
    generationError = e;
    logger.error({ conversationId, error: e }, "[chat] title generation request failed");
  }

  if (generated) {
    const titleOutcomeFailed = generated.cleanTitle == null;
    const titleOutcomeError = titleOutcomeFailed ? "Generated title was empty, fallback used" : "";
    chatEntries.updateTitleLlmStreamEntry(conversationId, {
      id: plannerEntryId,
      llmRequest: titlePrompt,
      llmResponse: generated.fullResponse,
      thoughtMs: Math.max(0, Date.now() - startedAtMs),
      decision: null,
      status: titleOutcomeFailed ? "failed" : "completed",
      ...(titleOutcomeFailed ? { error: titleOutcomeError } : {}),
      llmModel: generated.model,
      ...TokenUsageMapper.toEntryFields(generated.usage),
    });
    hub.publish(conversationId, {
      type: SseType.TITLE_RESPONSE,
      chatEntryId: plannerEntry.id,
      summary:
        generated.cleanTitle != null
          ? `Generated title: ${generated.cleanTitle}`
          : "Generated title was empty, fallback used",
      finished: true,
      action: generated.cleanTitle != null ? "final_answer" : "failed",
      llmModel: generated.model,
      ...TokenUsageMapper.toSseFields(generated.usage),
    });
  } else if (!generationError) {
    // No provider/model configured for title generation; close the thought row explicitly.
    const detail = "Title generation skipped, fallback used";
    chatEntries.updateTitleLlmStreamEntry(conversationId, {
      id: plannerEntryId,
      llmRequest: titlePrompt,
      llmResponse: "",
      thoughtMs: Math.max(0, Date.now() - startedAtMs),
      decision: null,
      status: "failed",
      error: detail,
    });
    hub.publish(conversationId, {
      type: SseType.TITLE_RESPONSE,
      chatEntryId: plannerEntry.id,
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
  const tokenUsageByModel = chatEntries
    .listConversationTokenUsageByModel()
    .filter((usage) => usage.conversation_id === conversationId)
    .map((usage) => normalizeConversationTokenUsageRow(usage))
    .filter((usage): usage is NonNullable<typeof usage> => usage !== null);
  hub.publish(conversationId, {
    type: SseType.CONVERSATION_UPDATED,
    conversation: {
      id: updated.id,
      title: updated.title,
      groupId: updated.group_id,
      isDeleted: Number(updated.is_deleted ?? 0) === 1,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
      promptTokensTotal: updated.prompt_tokens_total,
      cachedPromptTokensTotal: updated.cached_prompt_tokens_total,
      completionTokensTotal: updated.completion_tokens_total,
      tokenUsageByModel,
    },
  });

  if (generationError) {
    const detail = generationError instanceof Error ? generationError.message : String(generationError);
    chatEntries.updateTitleLlmStreamEntry(conversationId, {
      id: plannerEntryId,
      llmRequest: titlePrompt,
      llmResponse: streamedResponse,
      thoughtMs: Math.max(0, Date.now() - startedAtMs),
      decision: null,
      status: "failed",
      error: detail,
    });
    hub.publish(conversationId, {
      type: SseType.TITLE_RESPONSE,
      chatEntryId: plannerEntry.id,
      summary: "Title generation failed, fallback used",
      finished: true,
      action: "failed",
    });
  }
}
