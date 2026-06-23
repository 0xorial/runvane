import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module.js';
import { SseHubService } from './sse-hub.service.js';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [SseHubService],
  exports: [SseHubService],
})
export class SseModule {}
