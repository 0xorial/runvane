import { createZodDto } from 'nestjs-zod';
import { CancelPendingMessageRequestSchema } from '../../contracts/conversations.js';

export class CancelPendingMessageDto extends createZodDto(CancelPendingMessageRequestSchema) {}
