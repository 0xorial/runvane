import { createZodDto } from 'nestjs-zod';
import { CreateDockerSandboxRequestSchema } from '../../contracts/tool-sandbox.js';

export class CreateDockerSandboxDto extends createZodDto(CreateDockerSandboxRequestSchema) {}
