import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module.js';
import { LlmProvidersModule } from '../llmProviders/llmProviders.module.js';
import { ConversationMessageDraftService } from './conversation-message-draft.service.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';

@Module({
  imports: [DatabaseModule, LlmProvidersModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationMessageDraftService],
})
export class ConversationsModule {}
