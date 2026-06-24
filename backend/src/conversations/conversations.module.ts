import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module.js';
import { DecisionStep } from '../thoughtProcessing/steps/decisionStep.js';
import { PrepareStep } from '../thoughtProcessing/steps/prepareStep.js';
import { ReasonStep } from '../thoughtProcessing/steps/reasonStep.js';
import { AutoTitleThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/autoTitleProvider.js';
import { GuardrailThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/guardrailProvider.js';
import { PlannerThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/plannerProvider.js';
import { SummarizeAttachmentThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/summarizeAttachmentProvider.js';
import { SummarizeThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/summarizeProvider.js';
import { ToolParamsThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/toolParamsProvider.js';
import { ThoughtProcessingService } from '../thoughtProcessing/thought-processing.service.js';
import { RunToolService } from '../tools/run-tool.service.js';
import { ToolsModule } from '../tools/tools.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { ConversationCategorizerService } from './conversation-categorizer.service.js';
import { ConversationProcessorService } from './conversation-processor.service.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';

@Module({
  imports: [DatabaseModule, ToolsModule, UploadsModule],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    ConversationCategorizerService,
    ThoughtProcessingService,
    ConversationProcessorService,
    PrepareStep,
    ReasonStep,
    DecisionStep,
    AutoTitleThoughtTypeProvider,
    PlannerThoughtTypeProvider,
    ToolParamsThoughtTypeProvider,
    SummarizeThoughtTypeProvider,
    SummarizeAttachmentThoughtTypeProvider,
    GuardrailThoughtTypeProvider,
    RunToolService,
  ],
})
export class ConversationsModule {}
