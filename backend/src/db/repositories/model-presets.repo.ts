import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';

export type ModelPresetRow = {
  id: number;
  name: string;
  parameters: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type ModelPresetDbRow = {
  id: number;
  name: string;
  parameters_json: string | Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function parseObjectJson(raw: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function toRow(row: ModelPresetDbRow): ModelPresetRow {
  return {
    id: row.id,
    name: row.name,
    parameters: parseObjectJson(row.parameters_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

@Injectable()
export class ModelPresetsRepo {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<ModelPresetRow[]> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT id, name, parameters_json, created_at, updated_at
       FROM model_presets
       ORDER BY updated_at DESC, id DESC`,
    )) as ModelPresetDbRow[];
    return rows.map(toRow);
  }

  async get(id: number): Promise<ModelPresetRow | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT id, name, parameters_json, created_at, updated_at
       FROM model_presets
       WHERE id = ?`,
      id,
    )) as ModelPresetDbRow[];
    const row = rows[0];
    return row ? toRow(row) : null;
  }

  async create(input: { name: string; parameters: Record<string, unknown> }): Promise<ModelPresetRow> {
    const now = new Date().toISOString();
    const inserted = await this.prisma.$executeRawUnsafe(
      `INSERT INTO model_presets (name, parameters_json, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      input.name,
      JSON.stringify(input.parameters),
      now,
      now,
    );
    const idRows = (await this.prisma.$queryRawUnsafe(`SELECT last_insert_rowid() AS id`)) as Array<{ id: number }>;
    const id = Number(idRows[0]?.id ?? inserted);
    const row = await this.get(id);
    if (!row) throw new Error('failed to load inserted model preset');
    return row;
  }

  async update(id: number, input: { name: string; parameters: Record<string, unknown> }): Promise<ModelPresetRow | null> {
    const changed = await this.prisma.$executeRawUnsafe(
      `UPDATE model_presets
       SET name = ?, parameters_json = ?, updated_at = ?
       WHERE id = ?`,
      input.name,
      JSON.stringify(input.parameters),
      new Date().toISOString(),
      id,
    );
    if (Number(changed) === 0) return null;
    return this.get(id);
  }

  async delete(id: number): Promise<'ok' | 'not_found'> {
    const changed = await this.prisma.$executeRawUnsafe(`DELETE FROM model_presets WHERE id = ?`, id);
    return Number(changed) === 0 ? 'not_found' : 'ok';
  }
}
