import { createZodDto } from 'nestjs-zod';
import { AgentUpsertRequestSchema } from '../../contracts/agents.js';

// Create and update share the same request shape — both are partial upserts.
export class CreateAgentDto extends createZodDto(AgentUpsertRequestSchema) {}
export class UpdateAgentDto extends createZodDto(AgentUpsertRequestSchema) {}
