import { createZodDto } from 'nestjs-zod';
import { LlmProviderSettingsDocumentSchema } from '../../contracts/settings.js';
import { LlmProviderConnectionTestRequestSchema } from '../../contracts/settings.js';

export class PutLlmProviderSettingsDto extends createZodDto(LlmProviderSettingsDocumentSchema) {}
export class LlmProviderConnectionTestDto extends createZodDto(LlmProviderConnectionTestRequestSchema) {}
