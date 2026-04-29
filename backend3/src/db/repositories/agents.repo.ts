import { Injectable } from '@nestjs/common';
import type { AgentDefaultLlmConfiguration, AgentEntity } from '../../agents/agent.entity.js';
import { PrismaService } from '../prisma.service.js';

type AgentDbRow = {
  id: string;
  name: string;
  system_prompt: string | null;
  default_llm_configuration_json: string | null;
  default_model_preset_id: number | null;
  model_provider_id: string | null;
  model_name: string | null;
  created_at: string;
  updated_at: string;
};

function asModelReference(providerId: string | null, modelName: string | null): AgentEntity['model_reference'] {
  const provider_id = String(providerId ?? '').trim();
  const model_name = String(modelName ?? '').trim();
  if (!provider_id && !model_name) return null;
  return { provider_id, model_name };
}

function parseDefaultConfig(raw: string | null): AgentDefaultLlmConfiguration | null {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('agents: invalid default_llm_configuration_json');
  }
  return parsed as AgentDefaultLlmConfiguration;
}

function toAgentEntity(row: AgentDbRow): AgentEntity {
  return {
    id: row.id,
    name: row.name,
    system_prompt: row.system_prompt ?? '',
    default_llm_configuration: parseDefaultConfig(row.default_llm_configuration_json),
    default_model_preset_id: row.default_model_preset_id,
    model_reference: asModelReference(row.model_provider_id, row.model_name),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

@Injectable()
export class AgentsRepo {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<AgentEntity[]> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT
         id,
         name,
         system_prompt,
         default_llm_configuration_json,
         default_model_preset_id,
         model_provider_id,
         model_name,
         created_at,
         updated_at
       FROM agents
       ORDER BY updated_at DESC`,
    )) as AgentDbRow[];
    return rows.map((row) => toAgentEntity(row));
  }

  async get(id: string): Promise<AgentEntity | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT
         id,
         name,
         system_prompt,
         default_llm_configuration_json,
         default_model_preset_id,
         model_provider_id,
         model_name,
         created_at,
         updated_at
       FROM agents
       WHERE id = ?`,
      id,
    )) as AgentDbRow[];
    const row = rows[0];
    return row ? toAgentEntity(row) : null;
  }

  async create(input: {
    name: string;
    system_prompt?: string;
    default_llm_configuration?: AgentDefaultLlmConfiguration | null;
    default_model_preset_id?: number | null;
    model_reference?: { provider_id?: string; model_name?: string } | null;
  }): Promise<AgentEntity> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const providerId = input.model_reference?.provider_id?.trim() || null;
    const modelName = input.model_reference?.model_name?.trim() || null;
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO agents (
         id, name, system_prompt, default_llm_configuration_json, default_model_preset_id, model_provider_id, model_name,
         created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.name,
      input.system_prompt ?? '',
      input.default_llm_configuration ? JSON.stringify(input.default_llm_configuration) : null,
      input.default_model_preset_id ?? null,
      providerId,
      modelName,
      now,
      now,
    );
    const created = await this.get(id);
    if (!created) throw new Error('failed to create agent');
    return created;
  }

  async update(
    id: string,
    input: {
      name: string;
      system_prompt?: string;
      default_llm_configuration?: AgentDefaultLlmConfiguration | null;
      default_model_preset_id?: number | null;
      model_reference?: { provider_id?: string; model_name?: string } | null;
    },
  ): Promise<AgentEntity | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const providerId = input.model_reference?.provider_id?.trim() || null;
    const modelName = input.model_reference?.model_name?.trim() || null;
    await this.prisma.$executeRawUnsafe(
      `UPDATE agents
       SET name = ?,
           system_prompt = ?,
           default_llm_configuration_json = ?,
           default_model_preset_id = ?,
           model_provider_id = ?,
           model_name = ?,
           updated_at = ?
       WHERE id = ?`,
      input.name,
      input.system_prompt ?? '',
      input.default_llm_configuration ? JSON.stringify(input.default_llm_configuration) : null,
      input.default_model_preset_id ?? null,
      providerId,
      modelName,
      new Date().toISOString(),
      id,
    );
    return this.get(id);
  }

  async delete(id: string): Promise<boolean> {
    const count = await this.prisma.$executeRawUnsafe(`DELETE FROM agents WHERE id = ?`, id);
    return Number(count) > 0;
  }
}
