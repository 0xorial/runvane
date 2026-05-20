import { createZodDto } from 'nestjs-zod';
import { ModelCapabilityOverrideUpsertSchema } from '../../contracts/model-catalog.js';

export class ModelCapabilityOverrideDto extends createZodDto(ModelCapabilityOverrideUpsertSchema) {}
