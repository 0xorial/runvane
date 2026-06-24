import { Module } from '@nestjs/common';
import { ToolsModule } from '../tools/tools.module.js';
import { ToolHostService } from './tool-host.service.js';

/**
 * Stands up the tool-host connection and registers its runtime tools into the
 * (shared, singleton) ToolRegistry exported by ToolsModule.
 */
@Module({
  imports: [ToolsModule],
  providers: [ToolHostService],
  exports: [ToolHostService],
})
export class ToolHostModule {}
