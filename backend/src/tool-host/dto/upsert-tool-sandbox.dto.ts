import { createZodDto } from 'nestjs-zod';
import { UpsertToolSandboxRequestSchema } from '../../contracts/tool-sandbox.js';

export class UpsertToolSandboxDto extends createZodDto(UpsertToolSandboxRequestSchema) {}
