import { Module } from '@nestjs/common';
import { BashTool } from './builtins/bash/tool.js';
import { CurlTool } from './builtins/curl/tool.js';
import { GetCurrentTimeTool } from './builtins/get-current-time/tool.js';
import { DelegateLlmTool } from './builtins/delegate-llm/tool.js';
import { SerialTerminalTool } from './builtins/serial/tool.js';
import { SerialConnectionManager } from './builtins/serial/connection.js';
import { TOOL_TOKEN, ToolRegistry } from './tool-registry.js';
import { LlmProvidersModule } from '../llmProviders/llmProviders.module.js';
import { DatabaseModule } from '../db/database.module.js';

@Module({
  imports: [LlmProvidersModule, DatabaseModule],
  providers: [
    GetCurrentTimeTool,
    CurlTool,
    BashTool,
    DelegateLlmTool,
    SerialConnectionManager,
    SerialTerminalTool,
    {
      provide: TOOL_TOKEN,
      useFactory: (...tools) => tools,
      inject: [GetCurrentTimeTool, CurlTool, BashTool, DelegateLlmTool, SerialTerminalTool],
    },
    ToolRegistry,
  ],
  // SerialConnectionManager is exported so the terminal gateway can mirror the
  // agent's live serial session read-only.
  exports: [ToolRegistry, SerialConnectionManager],
})
export class ToolsModule {}
