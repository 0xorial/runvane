import { createZodDto } from 'nestjs-zod';
import { ReprocessContextRequestSchema } from '../../contracts/conversations.js';

export class ReprocessContextDto extends createZodDto(ReprocessContextRequestSchema) {}
