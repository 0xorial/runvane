import { Module } from '@nestjs/common';
import { AgentsRepo } from './repositories/agents.repo.js';
import { AppSettingsRepo } from './repositories/app-settings.repo.js';
import { ChatEntriesRepo } from './repositories/chat-entries.repo.js';
import { ConversationsRepo } from './repositories/conversations.repo.js';
import { LlmProviderSettingsRepo } from './repositories/llm-provider-settings.repo.js';
import { ModelCapabilitiesRepo } from './repositories/model-capabilities.repo.js';
import { ModelPresetsRepo } from './repositories/model-presets.repo.js';
import { ToolRunsRepo } from './repositories/tool-runs.repo.js';
import { UploadsRepo } from './repositories/uploads.repo.js';
import { PrismaService } from './prisma.service.js';
import { StreamCursorService } from './stream-cursor.service.js';

@Module({
  providers: [
    PrismaService,
    StreamCursorService,
    ChatEntriesRepo,
    ConversationsRepo,
    AgentsRepo,
    AppSettingsRepo,
    LlmProviderSettingsRepo,
    ModelPresetsRepo,
    ModelCapabilitiesRepo,
    UploadsRepo,
    ToolRunsRepo,
  ],
  exports: [
    PrismaService,
    StreamCursorService,
    ChatEntriesRepo,
    ConversationsRepo,
    AgentsRepo,
    AppSettingsRepo,
    LlmProviderSettingsRepo,
    ModelPresetsRepo,
    ModelCapabilitiesRepo,
    UploadsRepo,
    ToolRunsRepo,
  ],
})
export class DatabaseModule {}
