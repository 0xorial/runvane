import { Module } from '@nestjs/common';
import { LlmProvidersModule } from '../llmProviders/llmProviders.module.js';
import { AgentsRepo } from './repositories/agents.repo.js';
import { ChatEntriesRepo } from './repositories/chat-entries.repo.js';
import { ConversationsRepo } from './repositories/conversations.repo.js';
import { LlmProviderSettingsRepo } from './repositories/llm-provider-settings.repo.js';
import { ModelCapabilitiesRepo } from './repositories/model-capabilities.repo.js';
import { ModelPresetsRepo } from './repositories/model-presets.repo.js';
import { UploadsRepo } from './repositories/uploads.repo.js';
import { PrismaService } from './prisma.service.js';

@Module({
  imports: [LlmProvidersModule],
  providers: [
    PrismaService,
    ChatEntriesRepo,
    ConversationsRepo,
    AgentsRepo,
    LlmProviderSettingsRepo,
    ModelPresetsRepo,
    ModelCapabilitiesRepo,
    UploadsRepo,
  ],
  exports: [
    PrismaService,
    ChatEntriesRepo,
    ConversationsRepo,
    AgentsRepo,
    LlmProviderSettingsRepo,
    ModelPresetsRepo,
    ModelCapabilitiesRepo,
    UploadsRepo,
  ],
})
export class DatabaseModule {}
