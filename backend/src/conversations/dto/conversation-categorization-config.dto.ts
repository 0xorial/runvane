import { createZodDto } from 'nestjs-zod';
import { ConversationCategorizationConfigSchema } from '../../contracts/conversation-config.js';

export class ConversationCategorizationConfigDto extends createZodDto(
  ConversationCategorizationConfigSchema,
) {}
