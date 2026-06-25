import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  MessageEvent,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Sse,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { z } from 'zod';
import { ReprocessReasonDto } from './dto/reprocess-reason.dto.js';
import { ReprocessUserMessageDto } from './dto/reprocess-user-message.dto.js';
import { SummarizeConversationDto } from './dto/summarize-conversation.dto.js';
import { SseType } from '../contracts/sse.js';
import {
  ChatEntrySchema,
  ConversationRowSchema,
  GetConversationsResponseSchema,
  PostConversationMessageAcceptedResponseSchema,
} from '../contracts/conversations.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishConversationUpdated, toConversationSseRow } from '../sse/sse-helpers.js';
import { ConversationsService } from './conversations.service.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { SplitConversationDto } from './dto/split-conversation.dto.js';
import { PostConversationMessageDto } from './dto/post-conversation-message.dto.js';
import { CancelPendingMessageDto } from './dto/cancel-pending-message.dto.js';
import { ReprocessContextDto } from './dto/reprocess-context.dto.js';
import { SetDefaultViewLeafDto } from './dto/set-default-view-leaf.dto.js';
import { UpdateConversationDto } from './dto/update-conversation.dto.js';
import { ConversationCategorizationConfigDto } from './dto/conversation-categorization-config.dto.js';
import { ConversationCategorizerService } from './conversation-categorizer.service.js';
import { ConversationProcessorService } from './conversation-processor.service.js';
import { toClientChatEntry } from '../thoughtProcessing/inputSnapshot.js';
import { ValidateResponse } from '../validation/validate-response.decorator.js';

const ChatEntryArraySchema = z.array(ChatEntrySchema);
const GetConversationMessagesResponseSchema = z.object({
  entries: ChatEntryArraySchema,
  // SSE seq watermark: these entries reflect every event up to this seq. The
  // client baselines on it and applies live events strictly after it.
  seq: z.number().int().nonnegative(),
});

@Controller('api/conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly conversationProcessor: ConversationProcessorService,
    private readonly conversationsRepo: ConversationsRepo,
    private readonly chatEntries: ChatEntriesRepo,
    private readonly hub: SseHubService,
    private readonly categorizer: ConversationCategorizerService,
  ) {}

  @Get()
  @ValidateResponse(GetConversationsResponseSchema)
  async list(@Query('deleted') deleted?: string, @Query('limit') limitRaw?: string) {
    const deletedOnly = deleted === 'only';
    const parsedLimit = Number(limitRaw);
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;
    return this.conversations.list({ deletedOnly, limit });
  }

  // NOTE: declared before the `:conversationId` route so the static `config`
  // segment isn't captured as a conversation id.
  @Get('config')
  async getConfig() {
    return this.categorizer.getConfig();
  }

  @Put('config')
  async putConfig(@Body() body: ConversationCategorizationConfigDto) {
    return this.categorizer.setConfig(body);
  }

  @Get(':conversationId')
  @ValidateResponse(ConversationRowSchema)
  async getOne(@Param('conversationId') conversationId: string) {
    const row = await this.conversations.get(conversationId, { includeDeleted: true });
    if (!row) throw new NotFoundException('conversation not found');
    return row;
  }

  @Post()
  @ValidateResponse(ConversationRowSchema)
  async create(@Body() body: CreateConversationDto) {
    const created = await this.conversations.create({ title: body.title, toolEnvironmentId: body.toolEnvironmentId });
    const entity = await this.conversationsRepo.get(created.id);
    if (entity) {
      this.hub.publish(created.id, {
        type: SseType.CONVERSATION_CREATED,
        conversation: toConversationSseRow(entity),
      });
    }
    return created;
  }

  @Put(':conversationId')
  @ValidateResponse(ConversationRowSchema)
  async update(
    @Param('conversationId') conversationId: string,
    @Body() body: UpdateConversationDto,
  ) {
    const hasTitleUpdate = body.title !== undefined;
    const hasGroupIdUpdate = body.groupId !== undefined;
    const hasNewGroupNameUpdate = body.newGroupName !== undefined;
    const hasGroupPinnedUpdate = body.groupPinned !== undefined;
    if (!hasTitleUpdate && !hasGroupIdUpdate && !hasNewGroupNameUpdate && !hasGroupPinnedUpdate) {
      throw new BadRequestException('title, group, or pin update is required');
    }
    if (hasGroupIdUpdate && hasNewGroupNameUpdate) {
      throw new BadRequestException('provide either groupId or newGroupName, not both');
    }

    const existing = await this.conversations.get(conversationId, { includeDeleted: true });
    if (!existing) throw new NotFoundException('conversation not found');

    let updated = existing;

    if (hasTitleUpdate) {
      const nextTitle = body.title!;
      const titleUpdated = await this.conversations.updateTitle(conversationId, nextTitle);
      if (!titleUpdated) throw new NotFoundException('conversation not found or deleted');
      updated = titleUpdated;
    }

    if (hasGroupIdUpdate) {
      let groupUpdated;
      try {
        groupUpdated = await this.conversations.updateGroupId(conversationId, body.groupId ?? null);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'invalid groupId';
        throw new BadRequestException(detail);
      }
      if (!groupUpdated) throw new NotFoundException('conversation not found or deleted');
      updated = groupUpdated;
    }

    if (hasNewGroupNameUpdate) {
      const nextGroupName = body.newGroupName!;
      const groupUpdated = await this.conversations.updateGroupName(conversationId, nextGroupName);
      if (!groupUpdated) throw new NotFoundException('conversation not found or deleted');
      updated = groupUpdated;
    }

    // A manual group move always pins (locks) the assignment so the
    // auto-categorizer leaves it alone. Otherwise honor an explicit pin/unpin.
    // Unpinning frees the conversation, so re-run categorization in the background.
    const groupChanged = hasGroupIdUpdate || hasNewGroupNameUpdate;
    const pinTarget = groupChanged ? true : hasGroupPinnedUpdate ? body.groupPinned! : undefined;
    if (pinTarget !== undefined) {
      const pinned = await this.conversations.setGroupPinned(conversationId, pinTarget);
      if (pinned) updated = pinned;
      if (pinTarget === false) this.categorizer.categorizeInBackground(conversationId);
    }

    await publishConversationUpdated(this.hub, this.conversationsRepo, this.chatEntries, conversationId);
    return updated;
  }

  @Post(':conversationId/split')
  @HttpCode(201)
  @ValidateResponse(ConversationRowSchema)
  async split(
    @Param('conversationId') conversationId: string,
    @Body() body: SplitConversationDto,
  ) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');

    let created;
    try {
      created = await this.conversations.split(conversationId, body.entryId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'failed to split conversation';
      if (detail.startsWith('entry not found')) throw new NotFoundException(detail);
      throw new BadRequestException(detail);
    }

    // New conversation shows up in the sidebar.
    const createdEntity = await this.conversationsRepo.get(created.id);
    if (createdEntity) {
      this.hub.publish(created.id, {
        type: SseType.CONVERSATION_CREATED,
        conversation: toConversationSseRow(createdEntity, created.tokenUsageByModel),
      });
    }
    // Source conversation: refresh sidebar totals, and push a fresh transcript
    // snapshot so any open view of it drops the entries that just moved out.
    await publishConversationUpdated(this.hub, this.conversationsRepo, this.chatEntries, conversationId);
    await this.publishConversationSnapshot(conversationId);

    return created;
  }

  /** Re-broadcast the full entry snapshot for a conversation onto its live
   * stream (used after a split mutates which entries belong to it). */
  private async publishConversationSnapshot(conversationId: string): Promise<void> {
    const [snap, conversation] = await Promise.all([
      this.chatEntries.snapshot(conversationId),
      this.conversations.get(conversationId, { includeDeleted: true }),
    ]);
    this.hub.publish(conversationId, {
      type: SseType.CONVERSATION_SNAPSHOT,
      entries: snap.entries.map(toClientChatEntry),
      leafId: conversation?.defaultViewLeafEntryId ?? null,
      anchorId: conversation?.defaultViewLeafAnchorId ?? null,
    });
  }

  @Delete(':conversationId')
  @ValidateResponse(ConversationRowSchema)
  async softDelete(@Param('conversationId') conversationId: string) {
    const deleted = await this.conversations.softDelete(conversationId);
    if (!deleted) throw new NotFoundException('conversation not found or already deleted');
    await publishConversationUpdated(this.hub, this.conversationsRepo, this.chatEntries, conversationId);
    return deleted;
  }

  @Post(':conversationId/undelete')
  @ValidateResponse(ConversationRowSchema)
  async undelete(@Param('conversationId') conversationId: string) {
    const restored = await this.conversations.undelete(conversationId);
    if (!restored) throw new NotFoundException('conversation not found or not deleted');
    await publishConversationUpdated(this.hub, this.conversationsRepo, this.chatEntries, conversationId);
    return restored;
  }

  @Delete(':conversationId/permanent')
  @HttpCode(200)
  async hardDelete(@Param('conversationId') conversationId: string) {
    const removed = await this.conversations.hardDelete(conversationId);
    if (!removed) throw new NotFoundException('conversation not found or not deleted');
    return { conversationId, deleted: true };
  }

  @Get(':conversationId/messages')
  @ValidateResponse(GetConversationMessagesResponseSchema)
  async listMessages(
    @Param('conversationId') conversationId: string,
    @Query('all') allRaw?: string,
  ) {
    // Capture the watermark BEFORE reading entries: any event published during
    // the read has seq > this, so the client re-applies it idempotently rather
    // than dropping it. (Capturing after the read could lose such an event.)
    const seq = this.hub.currentSeq();
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    const entries = await this.conversations.listChatEntries(conversationId, {
      all: allRaw === '1' || allRaw === 'true',
    });
    return { entries: entries.map(toClientChatEntry), seq };
  }

  /**
   * Per-conversation live stream. First frame is the full snapshot (entries +
   * watermark seq); every frame after is a live mutation. The client seeds from
   * the snapshot, gates by seq > W, and re-subscribes (fresh snapshot) on
   * reconnect — no replay buffer, no client/server seq negotiation.
   */
  @Sse(':conversationId/stream')
  streamConversation(@Param('conversationId') conversationId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let snapshotSent = false;
      const buffered: MessageEvent[] = [];
      // Subscribe to the live tail FIRST so nothing slips the gap while we read
      // the snapshot; buffer until the snapshot frame is sent, then flush.
      const sub = this.hub.stream({ conversationId }).subscribe({
        next: (msg) => (snapshotSent ? subscriber.next(msg) : buffered.push(msg)),
        error: (err) => subscriber.error(err),
      });
      void (async () => {
        try {
          const [snap, conversation] = await Promise.all([
            this.chatEntries.snapshot(conversationId),
            this.conversations.get(conversationId, { includeDeleted: true }),
          ]);
          subscriber.next({
            id: String(snap.seq),
            data: {
              type: SseType.CONVERSATION_SNAPSHOT,
              conversationId,
              entries: snap.entries.map(toClientChatEntry),
              seq: snap.seq,
              leafId: conversation?.defaultViewLeafEntryId ?? null,
              anchorId: conversation?.defaultViewLeafAnchorId ?? null,
            },
          });
          snapshotSent = true;
          for (const msg of buffered) subscriber.next(msg);
          buffered.length = 0;
        } catch (err) {
          subscriber.error(err as Error);
        }
      })();
      return () => sub.unsubscribe();
    });
  }

  @Post(':conversationId/messages')
  @ValidateResponse(PostConversationMessageAcceptedResponseSchema)
  async postMessage(
    @Param('conversationId') conversationId: string,
    @Body() body: PostConversationMessageDto,
  ) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    await this.conversationProcessor.processMessage(conversationId, body);
    return { conversationId };
  }

  @Post(':conversationId/messages/cancel-pending')
  @HttpCode(200)
  async cancelPendingMessage(
    @Param('conversationId') conversationId: string,
    @Body() body: CancelPendingMessageDto,
  ) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    const cancelled = this.conversationProcessor.cancelPendingMessage(conversationId, body.clientRequestId);
    return { conversationId, cancelled };
  }

  @Post(':conversationId/default-view-leaf')
  async setDefaultViewLeaf(
    @Param('conversationId') conversationId: string,
    @Body() body: SetDefaultViewLeafDto,
  ) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    try {
      const updated = await this.conversations.setDefaultViewLeaf(conversationId, body.entryId);
      if (!updated || !updated.defaultViewLeafEntryId) {
        throw new NotFoundException('conversation not found');
      }
      return { conversationId, defaultViewLeafEntryId: updated.defaultViewLeafEntryId };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'invalid entryId';
      if (detail.startsWith('entry not found')) throw new NotFoundException(detail);
      throw new BadRequestException(detail);
    }
  }

  @Post(':conversationId/tool-invocations/:entryId/approve')
  @HttpCode(202)
  async approveToolInvocation(
    @Param('conversationId') conversationId: string,
    @Param('entryId') entryId: string,
  ) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    try {
      await this.conversationProcessor.approveToolInvocation({ conversationId, toolEntryId: entryId });
      return { conversationId, toolEntryId: entryId };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'failed to approve tool invocation';
      throw new BadRequestException(detail);
    }
  }

  @Post(':conversationId/cancel-processing')
  async cancelProcessing(@Param('conversationId') conversationId: string) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    const cancelledTasks = this.conversationProcessor.cancelProcessing(conversationId);
    return { conversationId, cancelledTasks };
  }

  @Post(':conversationId/thoughts/:entryId/reprocess-reason')
  @HttpCode(202)
  async reprocessReason(
    @Param('conversationId') conversationId: string,
    @Param('entryId') entryId: string,
    @Body() body: ReprocessReasonDto,
  ) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    try {
      const result = await this.conversationProcessor.startReprocessReason({
        conversationId,
        sourceEntryId: entryId,
        editedResponse: body.editedResponse,
      });
      return {
        conversationId,
        plannerEntryId: result.plannerEntryId,
        leafEntryId: result.leafEntryId,
        queuedToolCalls: 0,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'failed to reprocess thought';
      throw new BadRequestException(detail);
    }
  }

  @Post(':conversationId/messages/:entryId/reprocess')
  @HttpCode(202)
  async reprocessUserMessage(
    @Param('conversationId') conversationId: string,
    @Param('entryId') entryId: string,
    @Body() body: ReprocessUserMessageDto,
  ) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    try {
      const result = await this.conversationProcessor.reprocessUserMessage({
        conversationId,
        sourceEntryId: entryId,
        editedText: body.editedText,
      });
      return {
        conversationId,
        userMessageEntryId: result.userMessageEntryId,
        leafEntryId: result.leafEntryId,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'failed to reprocess user message';
      throw new BadRequestException(detail);
    }
  }

  @Post(':conversationId/summarize')
  @HttpCode(202)
  async summarize(
    @Param('conversationId') conversationId: string,
    @Body() body: SummarizeConversationDto,
  ) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    try {
      await this.conversationProcessor.startSummarize({
        conversationId,
        firstEntryToSummarize: body.firstEntryToSummarize,
      });
      return { conversationId };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'failed to summarize conversation';
      throw new BadRequestException(detail);
    }
  }

  @Post(':conversationId/thoughts/:entryId/reprocess-context')
  @HttpCode(202)
  async reprocessContext(
    @Param('conversationId') conversationId: string,
    @Param('entryId') entryId: string,
    @Body() body: ReprocessContextDto,
  ) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    try {
      const result = await this.conversationProcessor.startReprocessContext({
        conversationId,
        sourceEntryId: entryId,
        ...(body.editedRequestText ? { editedRequestText: body.editedRequestText } : {}),
        ...(body.llm ? { llm: body.llm } : {}),
      });
      return {
        conversationId,
        plannerEntryId: result.plannerEntryId,
        leafEntryId: result.leafEntryId,
        queuedToolCalls: 0,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'failed to reprocess thought';
      throw new BadRequestException(detail);
    }
  }
}
