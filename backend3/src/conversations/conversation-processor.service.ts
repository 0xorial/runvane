import { Injectable, Logger } from '@nestjs/common';
import { SseType } from '../contracts/sse.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishConversationUpdated } from '../sse/sse-helpers.js';
import { ThoughtProcessingService } from '../thoughtProcessing/thought-processing.service.js';
import { AutoTitleThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/autoTitleProvider.js';
import { PlannerThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/plannerProvider.js';
import { PostConversationMessageDto } from './dto/post-conversation-message.dto.js';
import { LifecycleScope } from './lifecycle-scope.js';

@Injectable()
export class ConversationProcessorService {
  private readonly logger = new Logger(ConversationProcessorService.name);
  private readonly activeExecutions = new Map<string, LifecycleScope>();

  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly thoughtProcessing: ThoughtProcessingService,
    private readonly conversations: ConversationsRepo,
    private readonly hub: SseHubService,
    private readonly autoTitleProvider: AutoTitleThoughtTypeProvider,
    private readonly plannerProvider: PlannerThoughtTypeProvider,
  ) {}

  private beginScope(conversationId: string): LifecycleScope {
    this.activeExecutions.get(conversationId)?.abort();
    const scope = new LifecycleScope(
      () => {
        if (this.activeExecutions.get(conversationId) === scope) {
          this.activeExecutions.delete(conversationId);
        }
      },
      (error) => {
        this.logger.error(
          `lifecycle scope task failed: conversation=${conversationId}`,
          error instanceof Error ? error.stack : String(error),
        );
      },
    );
    this.activeExecutions.set(conversationId, scope);
    return scope;
  }

  cancelProcessing(conversationId: string): number {
    const scope = this.activeExecutions.get(conversationId);
    if (!scope) return 0;
    scope.abort();
    return 1;
  }

  async startReprocessContext(args: {
    conversationId: string;
    sourceEntryId: string;
    editedRequestText: string;
  }): Promise<{ plannerEntryId: string }> {
    const scope = this.beginScope(args.conversationId);
    const result = await this.thoughtProcessing.startReprocessContext(args, scope);
    scope.rootDone();
    return result;
  }

  async startReprocessReason(args: {
    conversationId: string;
    sourceEntryId: string;
    editedResponse: string;
  }): Promise<{ plannerEntryId: string }> {
    const scope = this.beginScope(args.conversationId);
    const result = await this.thoughtProcessing.startReprocessReason(args, scope);
    scope.rootDone();
    return result;
  }

  async reprocessUserMessage(args: {
    conversationId: string;
    sourceEntryId: string;
    editedText: string;
  }): Promise<{ userMessageEntryId: string }> {
    const source = await this.chatEntries.getChatEntry(args.conversationId, args.sourceEntryId);
    if (!source) throw new Error(`source entry not found: ${args.sourceEntryId}`);
    if (source.type !== 'user-message') {
      throw new Error(`reprocess target ${args.sourceEntryId} is not a user-message: ${source.type}`);
    }

    const scope = this.beginScope(args.conversationId);
    const sibling = await this.chatEntries.appendUserMessage(args.conversationId, {
      text: args.editedText,
      agentId: source.agentId,
      ...(source.llmProviderId ? { llmProviderId: source.llmProviderId } : {}),
      ...(source.llmModel ? { llmModel: source.llmModel } : {}),
      ...(source.modelPresetId != null ? { modelPresetId: source.modelPresetId } : {}),
      parentId: source.parentId,
    });
    const siblingPayload = await this.chatEntries.getChatEntry(args.conversationId, sibling.id);
    if (!siblingPayload || siblingPayload.type !== 'user-message') {
      throw new Error(`appended user-message ${sibling.id} not retrievable as user-message`);
    }
    this.hub.publish(args.conversationId, { type: SseType.USER_MESSAGE, entry: siblingPayload });
    await publishConversationUpdated(this.hub, this.conversations, args.conversationId);

    this.thoughtProcessing.startSelfInitiatedThought(this.plannerProvider, args.conversationId, scope);
    scope.rootDone();
    return { userMessageEntryId: sibling.id };
  }

  async processMessage(conversationId: string, body: PostConversationMessageDto): Promise<void> {
    const scope = this.beginScope(conversationId);
    const existingMessages = await this.chatEntries.listMessages(conversationId);
    const userEntry = await this.chatEntries.appendUserMessage(conversationId, {
      text: body.message,
      agentId: body.agentId,
      llmProviderId: body.llmProviderId,
      llmModel: body.llmModel,
      modelPresetId: body.modelPresetId,
    });
    const userPayload = await this.chatEntries.getChatEntry(conversationId, userEntry.id);
    if (!userPayload || userPayload.type !== 'user-message') {
      throw new Error(`appended user-message ${userEntry.id} not retrievable as user-message`);
    }
    this.hub.publish(conversationId, { type: SseType.USER_MESSAGE, entry: userPayload });
    await publishConversationUpdated(this.hub, this.conversations, conversationId);

    if (existingMessages.length === 0) {
      this.thoughtProcessing.startSelfInitiatedThought(this.autoTitleProvider, conversationId, scope);
    }
    this.thoughtProcessing.startSelfInitiatedThought(this.plannerProvider, conversationId, scope);
    scope.rootDone();
  }
}
