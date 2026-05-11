import { Module } from '@nestjs/common';
import { SseModule } from '../sse/sse.module.js';
import { ToolsModule } from '../tools/tools.module.js';
import { SystemController } from './system.controller.js';

@Module({
  imports: [SseModule, ToolsModule],
  controllers: [SystemController],
})
export class SystemModule {}
