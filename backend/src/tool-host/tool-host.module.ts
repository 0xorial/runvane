import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module.js';
import { ToolsModule } from '../tools/tools.module.js';
import { ToolSandboxesController } from './tool-sandboxes.controller.js';
import { ToolSandboxesService } from './tool-sandboxes.service.js';
import { ToolHostService } from './tool-host.service.js';

/**
 * Stands up the tool-host connection and registers its target tools into the
 * (shared, singleton) ToolRegistry exported by ToolsModule, and serves the
 * tool-sandbox catalog/CRUD that conversations bind to.
 */
@Module({
  imports: [ToolsModule, DatabaseModule],
  controllers: [ToolSandboxesController],
  providers: [ToolHostService, ToolSandboxesService],
  exports: [ToolHostService, ToolSandboxesService],
})
export class ToolHostModule {}
