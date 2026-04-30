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
import { ConversationsService } from './conversations.service.js';
import { CreateConversationDto } from './dto/create-conversation.dto.js';
import { PostConversationMessageDto } from './dto/post-conversation-message.dto.js';
import { UpdateConversationDto } from './dto/update-conversation.dto.js';
import { ConversationMessageDraftService } from './conversation-message-draft.service.js';

@Controller('api/conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly messageDraft: ConversationMessageDraftService,
  ) {}

  @Get()
  async list(@Query('deleted') deleted?: string) {
    const deletedOnly = deleted === 'only';
    return this.conversations.list({ deletedOnly });
  }

  @Post()
  async create(@Body() body: CreateConversationDto) {
    return this.conversations.create({ title: body.title });
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

    return updated;
  }

  @Delete(':conversationId')
  async softDelete(@Param('conversationId') conversationId: string) {
    const deleted = await this.conversations.softDelete(conversationId);
    if (!deleted) throw new NotFoundException('conversation not found or already deleted');
    return deleted;
  }

  @Post(':conversationId/undelete')
  async undelete(@Param('conversationId') conversationId: string) {
    const restored = await this.conversations.undelete(conversationId);
    if (!restored) throw new NotFoundException('conversation not found or not deleted');
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
  async listMessages(@Param('conversationId') conversationId: string) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    return this.conversations.listMessages(conversationId);
  }

  @Post(':conversationId/messages')
  async postMessage(
    @Param('conversationId') conversationId: string,
    @Body() body: PostConversationMessageDto,
  ) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    return this.messageDraft.sendMessage(conversationId, body);
  }

  @Post(':conversationId/active-leaf')
  async setActiveLeaf(@Param('conversationId') conversationId: string) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    throw new NotImplementedException('active-leaf mutation is not implemented yet');
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
    throw new NotImplementedException('conversation processing cancellation is not implemented yet');
  }

  @Post(':conversationId/thoughts/:entryId/reprocess-reason')
  async reprocessReason(@Param('conversationId') conversationId: string) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    throw new NotImplementedException('thought reason reprocess is not implemented yet');
  }

  @Post(':conversationId/thoughts/:entryId/reprocess-context')
  async reprocessContext(@Param('conversationId') conversationId: string) {
    const exists = await this.conversations.get(conversationId);
    if (!exists) throw new NotFoundException('conversation not found');
    throw new NotImplementedException('thought context reprocess is not implemented yet');
  }
}
