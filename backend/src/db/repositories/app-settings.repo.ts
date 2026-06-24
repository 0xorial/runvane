import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';

/**
 * Generic key/value access to the `settings` (AppSetting) table. Values are
 * stored as JSON text — written with JSON.stringify and parsed on read — to
 * match the existing `llm_configuration` row convention in
 * LlmProviderSettingsRepo. Uses raw SQL so callers never depend on the
 * generated Prisma client knowing about the table.
 */
@Injectable()
export class AppSettingsRepo {
  constructor(private readonly prisma: PrismaService) {}

  async getJson<T = unknown>(key: string): Promise<T | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT value_json FROM settings WHERE key = ?`,
      key,
    )) as Array<{ value_json: unknown }>;
    const row = rows[0];
    if (!row) return null;
    const raw = row.value_json;
    if (raw == null) return null;
    try {
      const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
      return parsed as T;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)`,
      key,
      JSON.stringify(value),
      new Date().toISOString(),
    );
  }
}
