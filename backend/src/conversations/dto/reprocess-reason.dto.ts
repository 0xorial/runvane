import { createZodDto } from 'nestjs-zod';
import { ReprocessReasonRequestSchema } from '../../contracts/conversations.js';

export class ReprocessReasonDto extends createZodDto(ReprocessReasonRequestSchema) {}
