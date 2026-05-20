import { createZodDto } from 'nestjs-zod';
import { CreateConversationRequestSchema } from '../../contracts/conversations.js';

export class CreateConversationDto extends createZodDto(CreateConversationRequestSchema) {}
