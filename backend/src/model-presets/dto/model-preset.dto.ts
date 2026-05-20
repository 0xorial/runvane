import { createZodDto } from 'nestjs-zod';
import { ModelPresetUpsertRequestSchema } from '../../contracts/model-presets.js';

export class UpsertModelPresetDto extends createZodDto(ModelPresetUpsertRequestSchema) {}
