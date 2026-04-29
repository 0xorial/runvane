import { Module } from '@nestjs/common';
import { LlmProvidersModule } from '../llmProviders/llmProviders.module.js';
import { SseModule } from '../sse/sse.module.js';
import { SystemController } from './system.controller.js';

@Module({
  imports: [SseModule, LlmProvidersModule],
  controllers: [SystemController],
})
export class SystemModule {}
