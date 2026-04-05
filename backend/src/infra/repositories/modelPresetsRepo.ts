import type { SqliteDb } from "../db/client.js";
import { parseJsonObject } from "./json.js";

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
  parameters_json: string;
  created_at: string;
  updated_at: string;
};

function toRow(row: ModelPresetDbRow): ModelPresetRow {
  return {
    id: row.id,
    name: row.name,
    parameters: parseJsonObject(row.parameters_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class ModelPresetsRepo {
  constructor(private readonly db: SqliteDb) {}

  list(): ModelPresetRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, parameters_json, created_at, updated_at
         FROM model_presets
         ORDER BY updated_at DESC, id DESC`,
      )
      .all() as ModelPresetDbRow[];
    return rows.map(toRow);
  }

  get(id: number): ModelPresetRow | null {
    const row = this.db
      .prepare(
        `SELECT id, name, parameters_json, created_at, updated_at
         FROM model_presets
         WHERE id = ?`,
      )
      .get(id) as ModelPresetDbRow | undefined;
    return row ? toRow(row) : null;
  }

  create(input: { name: string; parameters: Record<string, unknown> }): ModelPresetRow {
    const now = new Date().toISOString();
    const inserted = this.db
      .prepare(
        `INSERT INTO model_presets
         (name, parameters_json, created_at, updated_at)
         VALUES (@name, @parameters_json, @created_at, @updated_at)`,
      )
      .run({
        name: input.name,
        parameters_json: JSON.stringify(input.parameters),
        created_at: now,
        updated_at: now,
      });
    const id = Number(inserted.lastInsertRowid);
    const row = this.get(id);
    if (!row) throw new Error("failed to load inserted model preset");
    return row;
  }

  update(id: number, input: { name: string; parameters: Record<string, unknown> }): ModelPresetRow | null {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE model_presets
         SET name = @name,
             parameters_json = @parameters_json,
             updated_at = @updated_at
         WHERE id = @id`,
      )
      .run({
        id,
        name: input.name,
        parameters_json: JSON.stringify(input.parameters),
        updated_at: now,
      });
    if (result.changes === 0) return null;
    return this.get(id);
  }

  delete(id: number): "ok" | "not_found" {
    const row = this.db
      .prepare("SELECT id FROM model_presets WHERE id = ?")
      .get(id) as { id?: number } | undefined;
    if (!row?.id) return "not_found";
    this.db.prepare("DELETE FROM model_presets WHERE id = ?").run(id);
    return "ok";
  }
}
