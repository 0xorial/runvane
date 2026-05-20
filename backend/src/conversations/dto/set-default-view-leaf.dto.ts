import { createZodDto } from 'nestjs-zod';
import { SetConversationActiveLeafRequestSchema } from '../../contracts/conversations.js';

export class SetDefaultViewLeafDto extends createZodDto(SetConversationActiveLeafRequestSchema) {}
