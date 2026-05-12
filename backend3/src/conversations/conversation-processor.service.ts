import { Injectable, Logger } from '@nestjs/common';
import { SseType } from '../contracts/sse.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishConversationUpdated } from '../sse/sse-helpers.js';
import { ThoughtProcessingService } from '../thoughtProcessing/thought-processing.service.js';
import type { ThoughtType } from '../thoughtProcessing/types.js';
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

    const thoughtTypes: ThoughtType[] = existingMessages.length === 0 ? ['autoTitle', 'planner'] : ['planner'];
    for (const thoughtType of thoughtTypes) {
      this.thoughtProcessing.startFullThoughtByType(conversationId, thoughtType, scope);
    }
    scope.rootDone();
  }
}
