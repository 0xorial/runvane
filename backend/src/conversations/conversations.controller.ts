import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
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
import { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishConversationUpdated, toConversationSseRow } from '../sse/sse-helpers.js';
import { ConversationsService } from './conversations.service.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { PostConversationMessageDto } from './dto/post-conversation-message.dto.js';
import { CancelPendingMessageDto } from './dto/cancel-pending-message.dto.js';
import { ReprocessContextDto } from './dto/reprocess-context.dto.js';
import { SetDefaultViewLeafDto } from './dto/set-default-view-leaf.dto.js';
import { UpdateConversationDto } from './dto/update-conversation.dto.js';
import { ConversationProcessorService } from './conversation-processor.service.js';
import { ValidateResponse } from '../validation/validate-response.decorator.js';

const ChatEntryArraySchema = z.array(ChatEntrySchema);

@Controller('api/conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly conversationProcessor: ConversationProcessorService,
    private readonly conversationsRepo: ConversationsRepo,
    private readonly hub: SseHubService,
  ) {}

  @Get()
  @ValidateResponse(GetConversationsResponseSchema)
  async list(@Query('deleted') deleted?: string) {
    const deletedOnly = deleted === 'only';
    return this.conversations.list({ deletedOnly });
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
    const created = await this.conversations.create({ title: body.title });
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
    if (!hasTitleUpdate && !hasGroupIdUpdate && !hasNewGroupNameUpdate) {
      throw new BadRequestException('title or group update is required');
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

    await publishConversationUpdated(this.hub, this.conversationsRepo, conversationId);
    return updated;
  }

  @Delete(':conversationId')
  @ValidateResponse(ConversationRowSchema)
  async softDelete(@Param('conversationId') conversationId: string) {
    const deleted = await this.conversations.softDelete(conversationId);
    if (!deleted) throw new NotFoundException('conversation not found or already deleted');
    await publishConversationUpdated(this.hub, this.conversationsRepo, conversationId);
    return deleted;
  }

  @Post(':conversationId/undelete')
  @ValidateResponse(ConversationRowSchema)
  async undelete(@Param('conversationId') conversationId: string) {
    const restored = await this.conversations.undelete(conversationId);
    if (!restored) throw new NotFoundException('conversation not found or not deleted');
    await publishConversationUpdated(this.hub, this.conversationsRepo, conversationId);
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
  @ValidateResponse(ChatEntryArraySchema)
  async listMessages(
    @Param('conversationId') conversationId: string,
    @Query('all') allRaw?: string,
  ) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    return this.conversations.listChatEntries(conversationId, { all: allRaw === '1' || allRaw === 'true' });
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
        editedRequestText: body.editedRequestText,
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
