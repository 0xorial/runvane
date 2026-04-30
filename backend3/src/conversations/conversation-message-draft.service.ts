import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { ModelPresetsRepo } from '../db/repositories/model-presets.repo.js';
import { LlmProviderSettingsRepo } from '../db/repositories/llm-provider-settings.repo.js';
import { LlmProviderRegistry } from '../llmProviders/registry.js';
import { PostConversationMessageDto } from './dto/post-conversation-message.dto.js';

@Injectable()
export class ConversationMessageDraftService {
  private readonly logger = new Logger(ConversationMessageDraftService.name);

  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly llmProviderSettings: LlmProviderSettingsRepo,
    private readonly modelPresets: ModelPresetsRepo,
    private readonly llmProviders: LlmProviderRegistry,
  ) {}

  async sendMessage(conversationId: string, body: PostConversationMessageDto) {
    const userMessage = await this.chatEntries.appendUserMessage(conversationId, {
      text: body.message,
      agentId: body.agentId,
      ...(body.llmProviderId ? { llmProviderId: body.llmProviderId.trim() } : {}),
      ...(body.llmModel ? { llmModel: body.llmModel.trim() } : {}),
      ...(body.modelPresetId !== undefined ? { modelPresetId: body.modelPresetId } : {}),
    });

    const llmDoc = await this.llmProviderSettings.getDocument();
    const providerId = body.llmProviderId?.trim() || llmDoc.llm_configuration.provider_id;
    const modelName = body.llmModel?.trim() || llmDoc.llm_configuration.model_name;

    if (!providerId) throw new BadRequestException('llm provider id is required');
    if (!modelName) throw new BadRequestException('llm model is required');

    const provider = this.llmProviders.get(providerId);
    if (!provider) throw new BadRequestException(`unknown llm provider: ${providerId}`);

    const providerConfig = llmDoc.providers.find((item) => item.id === providerId);
    if (!providerConfig) throw new BadRequestException(`llm provider is not configured: ${providerId}`);

    let requestParams = { ...llmDoc.llm_configuration.model_settings };
    if (body.modelPresetId !== undefined) {
      const preset = await this.modelPresets.get(body.modelPresetId);
      if (!preset) throw new BadRequestException(`model preset not found: ${body.modelPresetId}`);
      requestParams = { ...requestParams, ...preset.parameters };
    }

    let streamedText = '';
    const completion = await provider.streamTextCompletion(
      providerConfig.settings,
      {
        model: modelName,
        prompt: body.message,
        requestParams,
      },
      (delta) => {
        streamedText += delta;
      },
    );

    this.logger.log(
      {
        conversationId,
        providerId,
        modelName,
        userEntryId: userMessage.id,
        agentId: body.agentId,
        attachmentCount: body.attachmentIds?.length ?? 0,
      },
      'Draft conversation message completed',
    );

    await this.chatEntries.appendAssistantMessage(conversationId, {
      text: completion.text || streamedText,
      parentId: userMessage.id,
    });

    return {
      conversationId,
    };
  }
}
