import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module.js';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AgentsController],
  providers: [AgentsService],
})
export class AgentsModule {}
