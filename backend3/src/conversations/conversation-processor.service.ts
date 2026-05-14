import { Injectable, Logger } from '@nestjs/common';
import { SseType } from '../contracts/sse.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishConversationUpdated } from '../sse/sse-helpers.js';
import { ThoughtProcessingService } from '../thoughtProcessing/thought-processing.service.js';
import { AutoTitleThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/autoTitleProvider.js';
import { PlannerThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/plannerProvider.js';
import { UploadsService } from '../uploads/uploads.service.js';
import { ChatChain } from './chat-chain.js';
import { PostConversationMessageDto } from './dto/post-conversation-message.dto.js';
import { LifecycleScope } from './lifecycle-scope.js';

type ConversationRun = { scope: LifecycleScope; chain: ChatChain };

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
    private readonly uploads: UploadsService,
  ) {}

  private beginRun(conversationId: string): ConversationRun {
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
    return { scope, chain: new ChatChain() };
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
    const { scope, chain } = this.beginRun(args.conversationId);
    const llm = await this.thoughtProcessing.getLlmRef();
    const result = await this.thoughtProcessing.startReprocessContext(args, scope, chain, llm);
    scope.rootDone();
    return result;
  }

  async startReprocessReason(args: {
    conversationId: string;
    sourceEntryId: string;
    editedResponse: string;
  }): Promise<{ plannerEntryId: string }> {
    const { scope, chain } = this.beginRun(args.conversationId);
    const llm = await this.thoughtProcessing.getLlmRef();
    const result = await this.thoughtProcessing.startReprocessReason(args, scope, chain, llm);
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

    const { scope, chain } = this.beginRun(args.conversationId);
    const llm = await this.thoughtProcessing.getLlmRef();
    const sibling = await this.chatEntries.appendUserMessage(args.conversationId, {
      text: args.editedText,
      agentId: source.agentId,
      ...(source.llmProviderId ? { llmProviderId: source.llmProviderId } : {}),
      ...(source.llmModel ? { llmModel: source.llmModel } : {}),
      ...(source.modelPresetId != null ? { modelPresetId: source.modelPresetId } : {}),
      parentId: source.parentId,
      ...(source.attachments && source.attachments.length > 0 ? { attachments: source.attachments } : {}),
    });
    await this.chatEntries.setDefaultViewLeaf(args.conversationId, sibling.id);
    chain.setTip(sibling.id);
    const siblingPayload = await this.chatEntries.getChatEntry(args.conversationId, sibling.id);
    if (!siblingPayload || siblingPayload.type !== 'user-message') {
      throw new Error(`appended user-message ${sibling.id} not retrievable as user-message`);
    }
    this.hub.publish(args.conversationId, { type: SseType.USER_MESSAGE, entry: siblingPayload });
    await publishConversationUpdated(this.hub, this.conversations, args.conversationId);

    this.thoughtProcessing.startThought({
      provider: this.plannerProvider,
      conversationId: args.conversationId,
      scope,
      chain,
      llm,
    });
    scope.rootDone();
    return { userMessageEntryId: sibling.id };
  }

  async processMessage(conversationId: string, body: PostConversationMessageDto): Promise<void> {
    const { scope, chain } = this.beginRun(conversationId);
    const llm = await this.thoughtProcessing.getLlmRef();
    const existingMessages = await this.chatEntries.listMessages(conversationId);
    if (existingMessages.length > 0 && !body.parentId) {
      throw new Error('parentId is required when conversation already has messages');
    }
    const parentId = body.parentId ?? null;
    const attachments = body.attachmentIds && body.attachmentIds.length > 0
      ? await this.uploads.resolveChatAttachments(body.attachmentIds)
      : undefined;
    const userEntry = await this.chatEntries.appendUserMessage(conversationId, {
      text: body.message,
      agentId: body.agentId,
      llmProviderId: body.llmProviderId,
      llmModel: body.llmModel,
      modelPresetId: body.modelPresetId,
      parentId,
      ...(attachments ? { attachments } : {}),
    });
    await this.chatEntries.setDefaultViewLeaf(conversationId, userEntry.id);
    chain.setTip(userEntry.id);
    const userPayload = await this.chatEntries.getChatEntry(conversationId, userEntry.id);
    if (!userPayload || userPayload.type !== 'user-message') {
      throw new Error(`appended user-message ${userEntry.id} not retrievable as user-message`);
    }
    this.hub.publish(conversationId, {
      type: SseType.USER_MESSAGE,
      entry: userPayload,
      ...(body.clientRequestId ? { clientRequestId: body.clientRequestId } : {}),
    });
    await publishConversationUpdated(this.hub, this.conversations, conversationId);

    if (existingMessages.length === 0) {
      this.thoughtProcessing.startThought({ provider: this.autoTitleProvider, conversationId, scope, chain, llm });
    }
    this.thoughtProcessing.startThought({ provider: this.plannerProvider, conversationId, scope, chain, llm });
    scope.rootDone();
  }
}
