import { Module } from '@nestjs/common';
import { CurlTool } from './builtins/curl/tool.js';
import { GetCurrentTimeTool } from './builtins/get-current-time/tool.js';
import { TOOL_TOKEN, ToolRegistry } from './tool-registry.js';

@Module({
  providers: [
    GetCurrentTimeTool,
    CurlTool,
    {
      provide: TOOL_TOKEN,
      useFactory: (...tools) => tools,
      inject: [GetCurrentTimeTool, CurlTool],
    },
    ToolRegistry,
  ],
  exports: [ToolRegistry],
})
export class ToolsModule {}
