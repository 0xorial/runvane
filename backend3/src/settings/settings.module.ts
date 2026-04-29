import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module.js';
import { LlmProvidersModule } from '../llmProviders/llmProviders.module.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Module({
  imports: [DatabaseModule, LlmProvidersModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
