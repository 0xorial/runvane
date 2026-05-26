import { Injectable } from '@nestjs/common';
import { AgentsRepo } from '../db/repositories/agents.repo.js';
import { toAgentResponse, type AgentRouteResponse } from './agents.api.js';
import type { CreateAgentDto, UpdateAgentDto } from './dto/agent.dto.js';

@Injectable()
export class AgentsService {
  constructor(private readonly agents: AgentsRepo) {}

  async list(): Promise<AgentRouteResponse[]> {
    const rows = await this.agents.list();
    return rows.map(toAgentResponse);
  }

  async get(agentId: string): Promise<AgentRouteResponse | null> {
    const row = await this.agents.get(agentId);
    return row ? toAgentResponse(row) : null;
  }

  async create(input: CreateAgentDto): Promise<AgentRouteResponse> {
    const created = await this.agents.create({
      name: input.name ?? 'New agent',
      system_prompt: input.system_prompt ?? '',
      default_llm_configuration: input.default_llm_configuration ?? null,
      default_model_preset_id: input.default_model_preset_id ?? null,
      model_reference: input.model_reference ?? null,
    });
    return toAgentResponse(created);
  }

  async update(agentId: string, patch: UpdateAgentDto): Promise<AgentRouteResponse | null> {
    const existing = await this.agents.get(agentId);
    if (!existing) return null;
    const updated = await this.agents.update(agentId, {
      name: patch.name ?? existing.name,
      system_prompt: patch.system_prompt ?? existing.system_prompt,
      default_llm_configuration: patch.default_llm_configuration ?? existing.default_llm_configuration,
      default_model_preset_id: patch.default_model_preset_id ?? existing.default_model_preset_id,
      model_reference: patch.model_reference ?? existing.model_reference,
    });
    return updated ? toAgentResponse(updated) : null;
  }

  async delete(agentId: string): Promise<boolean> {
    return this.agents.delete(agentId);
  }

  async setDefault(agentId: string): Promise<AgentRouteResponse | null> {
    const updated = await this.agents.setDefault(agentId);
    return updated ? toAgentResponse(updated) : null;
  }
}
