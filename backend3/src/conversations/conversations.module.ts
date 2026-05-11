import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module.js';
import { LlmProvidersModule } from '../llmProviders/llmProviders.module.js';
import { DecisionStep } from '../thoughtProcessing/steps/decisionStep.js';
import { PrepareStep } from '../thoughtProcessing/steps/prepareStep.js';
import { ReasonStep } from '../thoughtProcessing/steps/reasonStep.js';
import { AutoTitleThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/autoTitleProvider.js';
import { PlannerThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/plannerProvider.js';
import { ThoughtProcessingService } from '../thoughtProcessing/thought-processing.service.js';
import { ToolsModule } from '../tools/tools.module.js';
import { ConversationProcessorService } from './conversation-processor.service.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';

@Module({
  imports: [DatabaseModule, LlmProvidersModule, ToolsModule],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    ThoughtProcessingService,
    ConversationProcessorService,
    PrepareStep,
    ReasonStep,
    DecisionStep,
    AutoTitleThoughtTypeProvider,
    PlannerThoughtTypeProvider,
  ],
})
export class ConversationsModule {}
