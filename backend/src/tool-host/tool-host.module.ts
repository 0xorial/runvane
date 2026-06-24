import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module.js';
import { ToolsModule } from '../tools/tools.module.js';
import { ToolEnvironmentsController } from './tool-environments.controller.js';
import { ToolEnvironmentsService } from './tool-environments.service.js';
import { ToolHostService } from './tool-host.service.js';

/**
 * Stands up the tool-host connection and registers its runtime tools into the
 * (shared, singleton) ToolRegistry exported by ToolsModule, and serves the
 * tool-environment catalog/CRUD that conversations bind to.
 */
@Module({
  imports: [ToolsModule, DatabaseModule],
  controllers: [ToolEnvironmentsController],
  providers: [ToolHostService, ToolEnvironmentsService],
  exports: [ToolHostService, ToolEnvironmentsService],
})
export class ToolHostModule {}
