import { Module } from '@nestjs/common';
import { ContextInjectionController } from '../context-injection/context-injection.controller.js';
import { ContextInjectionService } from '../context-injection/context-injection.service.js';
import { DatabaseModule } from '../db/database.module.js';
import { DecisionStep } from '../thoughtProcessing/steps/decisionStep.js';
import { PrepareStep } from '../thoughtProcessing/steps/prepareStep.js';
import { ReasonStep } from '../thoughtProcessing/steps/reasonStep.js';
import { AutoTitleThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/autoTitleProvider.js';
import { CategorizeThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/categorizeProvider.js';
import { GuardrailThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/guardrailProvider.js';
import { KnowledgePlanningThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/knowledgePlanningProvider.js';
import { PlannerThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/plannerProvider.js';
import { SummarizeAttachmentThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/summarizeAttachmentProvider.js';
import { SummarizeThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/summarizeProvider.js';
import { ToolParamsThoughtTypeProvider } from '../thoughtProcessing/thoughtTypeProviders/toolParamsProvider.js';
import { ThoughtProcessingService } from '../thoughtProcessing/thought-processing.service.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { ToolHostModule } from '../tool-host/tool-host.module.js';
import { RunToolService } from '../tools/run-tool.service.js';
import { ToolsModule } from '../tools/tools.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { ConversationCategorizerService } from './conversation-categorizer.service.js';
import { ConversationProcessorService } from './conversation-processor.service.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';

@Module({
  imports: [DatabaseModule, ToolsModule, UploadsModule, KnowledgeModule, ToolHostModule],
  controllers: [ConversationsController, ContextInjectionController],
  providers: [
    ConversationsService,
    ConversationCategorizerService,
    ThoughtProcessingService,
    ConversationProcessorService,
    PrepareStep,
    ReasonStep,
    DecisionStep,
    AutoTitleThoughtTypeProvider,
    CategorizeThoughtTypeProvider,
    PlannerThoughtTypeProvider,
    ToolParamsThoughtTypeProvider,
    SummarizeThoughtTypeProvider,
    SummarizeAttachmentThoughtTypeProvider,
    GuardrailThoughtTypeProvider,
    KnowledgePlanningThoughtTypeProvider,
    RunToolService,
    ContextInjectionService,
  ],
})
export class ConversationsModule {}
