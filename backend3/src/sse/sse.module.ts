import { Global, Module } from '@nestjs/common';
import { SseHubService } from './sse-hub.service.js';

@Global()
@Module({
  providers: [SseHubService],
  exports: [SseHubService],
})
export class SseModule {}
