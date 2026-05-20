import { createZodDto } from 'nestjs-zod';
import { ReprocessUserMessageRequestSchema } from '../../contracts/conversations.js';

export class ReprocessUserMessageDto extends createZodDto(ReprocessUserMessageRequestSchema) {}
