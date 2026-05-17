import { Module } from '@nestjs/common';
import { DatabaseModule } from '../db/database.module.js';
import { ModelPresetsController } from './model-presets.controller.js';
import { ModelPresetsService } from './model-presets.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [ModelPresetsController],
  providers: [ModelPresetsService],
})
export class ModelPresetsModule {}
