import { createZodDto } from 'nestjs-zod';
import { UpsertToolEnvironmentRequestSchema } from '../../contracts/tool-environment.js';

export class UpsertToolEnvironmentDto extends createZodDto(UpsertToolEnvironmentRequestSchema) {}
