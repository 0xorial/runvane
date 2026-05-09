import { Injectable, Logger } from '@nestjs/common';
import { SseType } from '../contracts/sse.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishConversationUpdated } from '../sse/sse-helpers.js';
import { ThoughtProcessingService, type StartedThought } from '../thoughtProcessing/thought-processing.service.js';
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

  async processMessage(conversationId: string, body: PostConversationMessageDto): Promise<void> {
    const handle = this.beginExecution(conversationId);
    let backgroundStarted = false;
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
      backgroundStarted = true;
      void this.runBackgroundThoughts(conversationId, thoughtTypes, handle);
    } catch (error) {
      handle.abort();
      handle.finish();
      throw error;
    }
    if (!backgroundStarted) {
      handle.finish();
    }
  }

  private async runBackgroundThoughts(
    conversationId: string,
    thoughtTypes: ThoughtType[],
    handle: ProcessingLifecycleHandle,
  ): Promise<void> {
    try {
      const started: Array<{ thoughtType: ThoughtType; handle: StartedThought }> = [];
      for (const thoughtType of thoughtTypes) {
        started.push({
          thoughtType,
          handle: await this.thoughtProcessing.startThought(conversationId, thoughtType, handle.signal),
        });
      }
      await Promise.all(
        started.map(({ thoughtType, handle: startedHandle }) =>
          this.thoughtProcessing.runThought(startedHandle, handle.signal).catch((error) => {
            this.logger.error(
              `thought processing failed: conversation=${conversationId} type=${thoughtType}`,
              error instanceof Error ? error.stack : String(error),
            );
          }),
        ),
      );
    } finally {
      handle.finish();
    }
  }
}
