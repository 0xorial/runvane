import { Injectable, Logger } from '@nestjs/common';
import { SseType } from '../contracts/sse.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishConversationUpdated } from '../sse/sse-helpers.js';
import { ThoughtProcessingService } from '../thoughtProcessing/thought-processing.service.js';
import type { ThoughtType } from '../thoughtProcessing/types.js';
import { PostConversationMessageDto } from './dto/post-conversation-message.dto.js';
import { ProcessingLifecycleHandle } from './processing-lifecycle-handle.js';

@Injectable()
export class ConversationProcessorService {
  private readonly logger = new Logger(ConversationProcessorService.name);
  private readonly activeExecutions = new Map<string, ProcessingLifecycleHandle>();

  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly thoughtProcessing: ThoughtProcessingService,
    private readonly conversations: ConversationsRepo,
    private readonly hub: SseHubService,
  ) {}

  private beginExecution(conversationId: string): ProcessingLifecycleHandle {
    this.activeExecutions.get(conversationId)?.abort();
    const handle = new ProcessingLifecycleHandle(() => {
      if (this.activeExecutions.get(conversationId) === handle) {
        this.activeExecutions.delete(conversationId);
      }
    });
    this.activeExecutions.set(conversationId, handle);
    return handle;
  }

  cancelProcessing(conversationId: string): number {
    const handle = this.activeExecutions.get(conversationId);
    if (!handle) return 0;
    handle.abort();
    handle.finish();
    return 1;
  }

  async reprocessContext(args: {
    conversationId: string;
    sourceEntryId: string;
    editedRequestText: string;
  }): Promise<{ plannerEntryId: string }> {
    const handle = this.beginExecution(args.conversationId);
    try {
      return await this.thoughtProcessing.runReprocessContext(args, handle.signal);
    } catch (error) {
      handle.abort();
      throw error;
    } finally {
      handle.finish();
    }
  }

  async reprocessReason(args: {
    conversationId: string;
    sourceEntryId: string;
    editedResponse: string;
  }): Promise<{ plannerEntryId: string }> {
    const handle = this.beginExecution(args.conversationId);
    try {
      return await this.thoughtProcessing.runReprocessReason(args, handle.signal);
    } catch (error) {
      handle.abort();
      throw error;
    } finally {
      handle.finish();
    }
  }

  async processMessage(conversationId: string, body: PostConversationMessageDto): Promise<void> {
    const handle = this.beginExecution(conversationId);
    try {
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
        try {
          await this.thoughtProcessing.runFullThoughtByType(conversationId, thoughtType, handle.signal);
        } catch (error) {
          this.logger.error(
            `thought processing failed: conversation=${conversationId} type=${thoughtType}`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    } catch (error) {
      handle.abort();
      throw error;
    } finally {
      handle.finish();
    }
  }
}
