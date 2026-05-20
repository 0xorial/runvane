import { createZodDto } from 'nestjs-zod';
import { PostConversationMessageRequestSchema } from '../../contracts/conversations.js';

export class PostConversationMessageDto extends createZodDto(PostConversationMessageRequestSchema) {}
