import { Injectable } from '@nestjs/common';
import { zerialize } from 'zodex';
import type { ChatAttachment, ChatEntry } from '../../../contracts/chatEntry.js';
import { LlmProviderSettingsRepo } from '../../../db/repositories/llm-provider-settings.repo.js';
import { expandAttachmentRefs } from '../../../llmProviders/expandAttachments.js';
import { LlmProviderRegistry } from '../../../llmProviders/registry.js';
import {
  getCompletionText,
  textMessage,
  type LlmCompletion,
  type LlmMessage,
  type LlmRequest,
} from '../../../llmProviders/types.js';
import { UploadsService } from '../../../uploads/uploads.service.js';
import { BaseTool, type ToolPolicy, type ToolRunContext } from '../../base-tool.js';
import { askAttachmentParamsSchema, parseAskAttachmentParams, type AskAttachmentParams } from './params.js';
import { AskAttachmentRulesSchema, parseAskAttachmentRules, type AskAttachmentRules } from './rules.js';

/**
 * RAG-via-subagent: answers a focused question about a single attachment.
 *
 * Loads the attachment's full bytes once per call and delegates to a sub-LLM
 * call that the agent never sees in its own context. Returns just the
 * answer text, capped by `max_answer_chars`. Pairs with the `summary` mode
 * delivery path: the planner sees only the summary, and uses this tool
 * when the summary isn't enough.
 *
 * No chunking / indexing on purpose — keeps infra surface small. The
 * downside is each call re-feeds the full attachment to the subagent
 * LLM, so we cap by `max_attachment_bytes` to bound cost.
 */
@Injectable()
export class AskAttachmentTool extends BaseTool<AskAttachmentParams, AskAttachmentRules> {
  constructor(
    private readonly uploads: UploadsService,
    private readonly providers: LlmProviderRegistry,
    private readonly providerSettings: LlmProviderSettingsRepo,
  ) {
    super();
  }

  getName(): string {
    return 'ask_attachment';
  }

  getAiDescription(): string {
    return (
      'Ask a focused question about one attachment present in this conversation. ' +
      'Use this when an <attachment_summary> block does not contain the detail you need. ' +
      'Returns a textual answer derived from the full file by a subagent. ' +
      'Pass `attachment_id` exactly as it appears on the <attachment_summary> block.'
    );
  }

  getHumanDescription(): string {
    return 'Query a single attachment via a subagent that sees the full content.';
  }

  getParamsSchema(): unknown {
    return askAttachmentParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(AskAttachmentRulesSchema);
  }

  getDefaultRules(): AskAttachmentRules {
    return parseAskAttachmentRules({});
  }

  parseParams(raw: unknown): AskAttachmentParams {
    return parseAskAttachmentParams(raw);
  }

  parseRules(raw: unknown): AskAttachmentRules {
    return parseAskAttachmentRules(raw);
  }

  getDefaultPolicy(): ToolPolicy {
    return 'allow';
  }

  async runTool(params: AskAttachmentParams, context: ToolRunContext): Promise<unknown> {
    const rules = parseAskAttachmentRules(context.toolRules ?? this.getDefaultRules());
    context.signal.throwIfAborted();
    const attachment = findAttachmentInConversation(context.entries, params.attachment_id);
    if (!attachment) {
      throw new Error(`ask_attachment: attachment '${params.attachment_id}' is not on this conversation`);
    }
    if (attachment.sizeBytes > rules.max_attachment_bytes) {
      throw new Error(
        `ask_attachment: attachment '${attachment.id}' is ${attachment.sizeBytes} bytes ` +
          `(limit ${rules.max_attachment_bytes})`,
      );
    }

    const llm = await this.resolveLlm(params);
    const provider = this.providers.get(llm.providerId);
    if (!provider) throw new Error(`ask_attachment: unknown provider '${llm.providerId}'`);
    const providerSettings = await this.providerSettings.getProviderSettings(llm.providerId);
    if (!providerSettings) throw new Error(`ask_attachment: no settings for provider '${llm.providerId}'`);

    const request = buildAskRequest(attachment, params.question);
    const wireRequest = await expandAttachmentRefs(request, async (id) => {
      const content = await this.uploads.readContentById(id);
      if (!content) return null;
      return {
        filename: content.attachment.name,
        mime: content.attachment.mimeType || 'application/octet-stream',
        bytes: content.data,
      };
    });

    let completion: LlmCompletion;
    try {
      completion = await provider.streamCompletion(
        providerSettings,
        llm.model,
        wireRequest,
        (event) => {
          if (event.type === 'text_delta') context.onProgress?.(event.delta);
        },
        context.signal,
      );
    } catch (err) {
      // Providers wrap aborts as StreamInterruptedError; re-surface as a clean
      // AbortError so the runtime treats it as a cancellation.
      if (context.signal.aborted) context.signal.throwIfAborted();
      throw err;
    }
    const fullAnswer = getCompletionText(completion).trim();
    const answer =
      fullAnswer.length > rules.max_answer_chars ? fullAnswer.slice(0, rules.max_answer_chars) : fullAnswer;
    return {
      attachment_id: attachment.id,
      filename: attachment.name,
      provider_id: llm.providerId,
      model_name: llm.model,
      answer,
      answer_chars: answer.length,
    };
  }

  private async resolveLlm(params: AskAttachmentParams): Promise<{ providerId: string; model: string }> {
    if (params.provider_id && params.model_name) {
      return { providerId: params.provider_id, model: params.model_name };
    }
    const doc = await this.providerSettings.getDocument();
    return { providerId: doc.llm_configuration.provider_id, model: doc.llm_configuration.model_name };
  }
}

function findAttachmentInConversation(entries: ChatEntry[], attachmentId: string): ChatAttachment | null {
  for (const entry of entries) {
    if (entry.type !== 'user-message') continue;
    const match = entry.attachments?.find((a) => a.id === attachmentId);
    if (match) return match;
  }
  return null;
}

function buildAskRequest(attachment: ChatAttachment, question: string): LlmRequest {
  const messages: LlmMessage[] = [
    textMessage(
      'system',
      'You are a focused retrieval subagent. You receive a single attachment plus a question about it. ' +
        'Answer concretely and concisely using only the attached content. If the answer is not present, ' +
        'say so explicitly. Quote short fragments when useful. Do not add unrelated commentary.',
    ),
    {
      role: 'user',
      parts: [
        {
          kind: 'text',
          text:
            `Attachment: ${attachment.name} (${attachment.mimeType}, ${attachment.sizeBytes} bytes).\n` +
            `Question: ${question}`,
        },
        {
          kind: 'attachment_ref',
          attachmentId: attachment.id,
          mime: attachment.mimeType,
          filename: attachment.name,
          sizeBytes: attachment.sizeBytes,
        },
      ],
    },
  ];
  return { messages };
}
