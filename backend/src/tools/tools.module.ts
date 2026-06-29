import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module.js';
import { ModelPresetsModule } from '../model-presets/model-presets.module.js';
import { AskAttachmentTool } from './builtins/ask-attachment/tool.js';
import { ApiTool } from './builtins/api/tool.js';
import { BashTool } from './builtins/bash/tool.js';
import { ConversationsTool } from './builtins/conversations/tool.js';
import { CurlTool } from './builtins/curl/tool.js';
import { RagTool } from './builtins/rag/tool.js';
import { FilesystemTool } from './builtins/filesystem/tool.js';
import { FilesystemIndexStore } from './builtins/filesystem-index/filesystem-index-store.service.js';
import { FilesystemIndexTool } from './builtins/filesystem-index/tool.js';
import { GetCurrentTimeTool } from './builtins/get-current-time/tool.js';
import { DelegateLlmTool } from './builtins/delegate-llm/tool.js';
import { SerialTerminalTool } from './builtins/serial/tool.js';
import { SerialConnectionManager } from './builtins/serial/connection.js';
import { WebSearchTool } from './builtins/web-search/tool.js';
import { WebBrowseTool } from './builtins/web-browse/tool.js';
import { TOOL_TOKEN, ToolRegistry } from './tool-registry.js';
import { DatabaseModule } from '../db/database.module.js';
import { RagModule } from '../rag/rag.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';

@Module({
  imports: [DatabaseModule, UploadsModule, AgentsModule, ModelPresetsModule, RagModule],
  providers: [
    GetCurrentTimeTool,
    CurlTool,
    BashTool,
    FilesystemTool,
    FilesystemIndexStore,
    FilesystemIndexTool,
    RagTool,
    ApiTool,
    ConversationsTool,
    DelegateLlmTool,
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
        CurlTool,
        BashTool,
        FilesystemTool,
        FilesystemIndexTool,
        RagTool,
        ApiTool,
        ConversationsTool,
        DelegateLlmTool,
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
