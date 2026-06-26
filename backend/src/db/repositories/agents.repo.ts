import { Injectable } from '@nestjs/common';
import type { AgentConfiguration, AgentEntity } from '../../agents/agent.entity.js';
import { PrismaService } from '../prisma.service.js';

type AgentDbRow = {
  id: string;
  name: string;
  system_prompt: string | null;
  default_llm_configuration_json: unknown;
  default_model_preset_id: number | null;
  model_provider_id: string | null;
  model_name: string | null;
  is_default: number;
  icon: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT_COLS = `
  id,
  name,
  system_prompt,
  default_llm_configuration_json,
  default_model_preset_id,
  model_provider_id,
  model_name,
  is_default,
  icon,
  color,
  created_at,
  updated_at
`;

function asModelReference(providerId: string | null, modelName: string | null): AgentEntity['model_reference'] {
  const provider_id = String(providerId ?? '').trim();
  const model_name = String(modelName ?? '').trim();
  if (!provider_id && !model_name) return null;
  return { provider_id, model_name };
}

/**
 * Coerce legacy per-tool config (`{ enabled, rules.allowed }`) to the current
 * `{ policy }` shape on read, so older stored agents keep working without a SQL
 * data migration. Idempotent: entries already carrying `policy` only get their
 * stale `rules.allowed` stripped. The new shape is persisted lazily on next save.
 */
function migrateLegacyToolPolicies(config: Record<string, unknown>): void {
  const tools = config.tools;
  if (!tools || typeof tools !== 'object' || Array.isArray(tools)) return;
  for (const entry of Object.values(tools as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    let allowed: unknown;
    if (rec.rules && typeof rec.rules === 'object' && !Array.isArray(rec.rules)) {
      const rules = rec.rules as Record<string, unknown>;
      allowed = rules.allowed;
      delete rules.allowed;
    }
    if (rec.policy === undefined) {
      rec.policy =
        rec.enabled !== true ? 'off' : allowed === 'never' ? 'off' : allowed === 'always' ? 'allow' : 'ask';
    }
    delete rec.enabled;
  }
}

function parseDefaultConfig(raw: unknown): AgentConfiguration | null {
  if (raw == null) return null;
  const value = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('agents: invalid default_llm_configuration_json');
  }
  migrateLegacyToolPolicies(value as Record<string, unknown>);
  return value as AgentConfiguration;
}

function toAgentEntity(row: AgentDbRow): AgentEntity {
  return {
    id: row.id,
    name: row.name,
    system_prompt: row.system_prompt ?? '',
    default_llm_configuration: parseDefaultConfig(row.default_llm_configuration_json),
    default_model_preset_id: row.default_model_preset_id,
    model_reference: asModelReference(row.model_provider_id, row.model_name),
    is_default: row.is_default === 1,
    icon: row.icon,
    color: row.color,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

@Injectable()
export class AgentsRepo {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<AgentEntity[]> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT ${SELECT_COLS} FROM agents ORDER BY updated_at DESC`,
    )) as AgentDbRow[];
    return rows.map((row) => toAgentEntity(row));
  }

  async get(id: string): Promise<AgentEntity | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT ${SELECT_COLS} FROM agents WHERE id = ?`,
      id,
    )) as AgentDbRow[];
    const row = rows[0];
    return row ? toAgentEntity(row) : null;
  }

  async getDefault(): Promise<AgentEntity | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT ${SELECT_COLS} FROM agents WHERE is_default = 1 LIMIT 1`,
    )) as AgentDbRow[];
    const row = rows[0];
    return row ? toAgentEntity(row) : null;
  }

  async setDefault(id: string): Promise<AgentEntity | null> {
    const target = await this.get(id);
    if (!target) return null;
    // Clear before setting so the partial-unique index on `is_default = 1`
    // never sees two truthy rows simultaneously.
    await this.prisma.$executeRawUnsafe(`UPDATE agents SET is_default = 0 WHERE is_default = 1 AND id != ?`, id);
    await this.prisma.$executeRawUnsafe(`UPDATE agents SET is_default = 1 WHERE id = ?`, id);
    return this.get(id);
  }

  async create(input: {
    name: string;
    system_prompt?: string;
    default_llm_configuration?: AgentConfiguration | null;
    default_model_preset_id?: number | null;
    model_reference?: { provider_id?: string; model_name?: string } | null;
    icon?: string | null;
    color?: string | null;
  }): Promise<AgentEntity> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const providerId = input.model_reference?.provider_id?.trim() || null;
    const modelName = input.model_reference?.model_name?.trim() || null;
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO agents (
         id, name, system_prompt, default_llm_configuration_json, default_model_preset_id, model_provider_id, model_name,
         icon, color, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.name,
      input.system_prompt ?? '',
      input.default_llm_configuration ? JSON.stringify(input.default_llm_configuration) : null,
      input.default_model_preset_id ?? null,
      providerId,
      modelName,
      input.icon?.trim() || null,
      input.color?.trim() || null,
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
      default_llm_configuration?: AgentConfiguration | null;
      default_model_preset_id?: number | null;
      model_reference?: { provider_id?: string; model_name?: string } | null;
      icon?: string | null;
      color?: string | null;
    },
  ): Promise<AgentEntity | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const providerId = input.model_reference?.provider_id?.trim() || null;
    const modelName = input.model_reference?.model_name?.trim() || null;
    const icon = input.icon === undefined ? existing.icon : (input.icon?.trim() || null);
    const color = input.color === undefined ? existing.color : (input.color?.trim() || null);
    await this.prisma.$executeRawUnsafe(
      `UPDATE agents
       SET name = ?,
           system_prompt = ?,
           default_llm_configuration_json = ?,
           default_model_preset_id = ?,
           model_provider_id = ?,
           model_name = ?,
           icon = ?,
           color = ?,
           updated_at = ?
       WHERE id = ?`,
      input.name,
      input.system_prompt ?? '',
      input.default_llm_configuration ? JSON.stringify(input.default_llm_configuration) : null,
      input.default_model_preset_id ?? null,
      providerId,
      modelName,
      icon,
      color,
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
