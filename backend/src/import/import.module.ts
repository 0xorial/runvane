import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module.js';
import { DatabaseModule } from '../db/database.module.js';
import { ChatHistoryImportService } from './chat-history-import.service.js';
import { ImportController } from './import.controller.js';

@Module({
  imports: [DatabaseModule, AgentsModule],
  controllers: [ImportController],
  providers: [ChatHistoryImportService],
})
export class ImportModule {}
