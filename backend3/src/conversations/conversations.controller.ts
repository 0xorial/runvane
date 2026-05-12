import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  NotImplementedException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ReprocessReasonDto } from './dto/reprocess-reason.dto.js';
import { SseType } from '../contracts/sse.js';
import { ConversationsRepo } from '../db/repositories/conversations.repo.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { publishConversationUpdated, toConversationSseRow } from '../sse/sse-helpers.js';
import { ConversationsService } from './conversations.service.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { PostConversationMessageDto } from './dto/post-conversation-message.dto.js';
import { ReprocessContextDto } from './dto/reprocess-context.dto.js';
import { SetActiveLeafDto } from './dto/set-active-leaf.dto.js';
import { UpdateConversationDto } from './dto/update-conversation.dto.js';
import { ConversationProcessorService } from './conversation-processor.service.js';

@Controller('api/conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly conversationProcessor: ConversationProcessorService,
    private readonly conversationsRepo: ConversationsRepo,
    private readonly hub: SseHubService,
  ) {}

  @Get()
  async list(@Query('deleted') deleted?: string) {
    const deletedOnly = deleted === 'only';
    return this.conversations.list({ deletedOnly });
  }

  @Get(':conversationId')
  async getOne(@Param('conversationId') conversationId: string) {
    const row = await this.conversations.get(conversationId, { includeDeleted: true });
    if (!row) throw new NotFoundException('conversation not found');
    return row;
  }

  @Post()
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
  async softDelete(@Param('conversationId') conversationId: string) {
    const deleted = await this.conversations.softDelete(conversationId);
    if (!deleted) throw new NotFoundException('conversation not found or already deleted');
    await publishConversationUpdated(this.hub, this.conversationsRepo, conversationId);
    return deleted;
  }

  @Post(':conversationId/undelete')
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
  async listMessages(
    @Param('conversationId') conversationId: string,
    @Query('all') allRaw?: string,
  ) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    return this.conversations.listChatEntries(conversationId, { all: allRaw === '1' || allRaw === 'true' });
  }

  @Post(':conversationId/messages')
  async postMessage(
    @Param('conversationId') conversationId: string,
    @Body() body: PostConversationMessageDto,
  ) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    await this.conversationProcessor.processMessage(conversationId, body);
    return { conversationId };
  }

  @Post(':conversationId/active-leaf')
  async setActiveLeaf(
    @Param('conversationId') conversationId: string,
    @Body() body: SetActiveLeafDto,
  ) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    try {
      const updated = await this.conversations.setActiveLeaf(conversationId, body.entryId);
      if (!updated || !updated.activeLeafEntryId) {
        throw new NotFoundException('conversation not found');
      }
      return { conversationId, activeLeafEntryId: updated.activeLeafEntryId };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'invalid entryId';
      if (detail.startsWith('entry not found')) throw new NotFoundException(detail);
      throw new BadRequestException(detail);
    }
  }

  @Post(':conversationId/tool-invocations/:entryId/approve')
  async approveToolInvocation(@Param('conversationId') conversationId: string) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    throw new NotImplementedException('tool invocation approval is not implemented yet');
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
      return { conversationId, plannerEntryId: result.plannerEntryId, queuedToolCalls: 0 };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'failed to reprocess thought';
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
      });
      return { conversationId, plannerEntryId: result.plannerEntryId, queuedToolCalls: 0 };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'failed to reprocess thought';
      throw new BadRequestException(detail);
    }
  }
}
