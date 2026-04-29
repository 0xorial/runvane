import { Module } from '@nestjs/common';
import { SseController } from './sse.controller.js';
import { SseHubService } from './sse-hub.service.js';

@Module({
  controllers: [SseController],
  providers: [SseHubService],
  exports: [SseHubService],
})
export class SseModule {}
