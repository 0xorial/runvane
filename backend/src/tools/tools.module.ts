import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module.js';
import { ModelPresetsModule } from '../model-presets/model-presets.module.js';
import { AskAttachmentTool } from './builtins/ask-attachment/tool.js';
import { ApiTool } from './builtins/api/tool.js';
import { ConversationsTool } from './builtins/conversations/tool.js';
import { KnowledgeTool } from './builtins/knowledge/tool.js';
import { FilesystemIndexStore } from './builtins/filesystem-index/filesystem-index-store.service.js';
import { FilesystemIndexTool } from './builtins/filesystem-index/tool.js';
import { GetCurrentTimeTool } from './builtins/get-current-time/tool.js';
import { TodoWriteTool } from './builtins/todo/tool.js';
import { DelegateLlmTool } from './builtins/delegate-llm/tool.js';
import { SwitchLlmTool } from './builtins/switch-llm/tool.js';
import { SerialTerminalTool } from './builtins/serial/tool.js';
import { SerialConnectionManager } from './builtins/serial/connection.js';
import { WebSearchTool } from './builtins/web-search/tool.js';
import { WebBrowseTool } from './builtins/web-browse/tool.js';
import { TOOL_TOKEN, ToolRegistry } from './tool-registry.js';
import { DatabaseModule } from '../db/database.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';

@Module({
  imports: [DatabaseModule, UploadsModule, AgentsModule, ModelPresetsModule, KnowledgeModule],
  providers: [
    GetCurrentTimeTool,
    TodoWriteTool,
    FilesystemIndexStore,
    FilesystemIndexTool,
    KnowledgeTool,
    ApiTool,
    ConversationsTool,
    DelegateLlmTool,
    SwitchLlmTool,
    AskAttachmentTool,
    SerialConnectionManager,
    SerialTerminalTool,
    WebSearchTool,
    WebBrowseTool,
    {
      provide: TOOL_TOKEN,
      useFactory: (...tools) => tools,
      inject: [
        GetCurrentTimeTool,
        TodoWriteTool,
        FilesystemIndexTool,
        KnowledgeTool,
        ApiTool,
        ConversationsTool,
        DelegateLlmTool,
        SwitchLlmTool,
        AskAttachmentTool,
        SerialTerminalTool,
        WebSearchTool,
        WebBrowseTool,
      ],
    },
    ToolRegistry,
  ],
  // SerialConnectionManager is exported so the terminal gateway can mirror the
  // agent's live serial session read-only.
  exports: [ToolRegistry, SerialConnectionManager],
})
export class ToolsModule {}
