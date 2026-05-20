import { createZodDto } from 'nestjs-zod';
import { UpdateConversationRequestSchema } from '../../contracts/conversations.js';

export class UpdateConversationDto extends createZodDto(UpdateConversationRequestSchema) {}
