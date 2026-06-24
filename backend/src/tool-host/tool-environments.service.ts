import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AppSettingsRepo } from '../db/repositories/app-settings.repo.js';
import {
  BUILTIN_ENVIRONMENT_IDS,
  BUILTIN_TOOL_ENVIRONMENTS,
  DEFAULT_TOOL_ENVIRONMENT_ID,
  TOOL_ENVIRONMENTS_SETTING_KEY,
  ToolEnvironmentSchema,
  type ToolEnvironment,
  type UpsertToolEnvironmentRequest,
} from '../contracts/tool-environment.js';

/**
 * Catalog of tool environments: the two built-ins (`local`, `none`) plus the
 * user-defined `ssh` ones stored as a JSON blob in the settings table. A
 * conversation binds to one of these ids.
 */
@Injectable()
export class ToolEnvironmentsService {
  constructor(private readonly settings: AppSettingsRepo) {}

  async list(): Promise<ToolEnvironment[]> {
    return [...BUILTIN_TOOL_ENVIRONMENTS, ...(await this.listExternal())];
  }

  async listExternal(): Promise<ToolEnvironment[]> {
    const raw = await this.settings.getJson<unknown>(TOOL_ENVIRONMENTS_SETTING_KEY);
    if (!Array.isArray(raw)) return [];
    const out: ToolEnvironment[] = [];
    for (const item of raw) {
      const parsed = ToolEnvironmentSchema.safeParse(item);
      // Only keep well-formed, non-builtin entries (builtins are code-defined).
      if (parsed.success && !parsed.data.builtin && !BUILTIN_ENVIRONMENT_IDS.includes(parsed.data.id)) {
        out.push(parsed.data);
      }
    }
    return out;
  }

  async get(id: string): Promise<ToolEnvironment | null> {
    return (await this.list()).find((e) => e.id === id) ?? null;
  }

  /** Resolve an id to a known environment, falling back to the default (local). */
  async getOrDefault(id: string | null | undefined): Promise<ToolEnvironment> {
    const all = await this.list();
    const found = id ? all.find((e) => e.id === id) : undefined;
    return found ?? all.find((e) => e.id === DEFAULT_TOOL_ENVIRONMENT_ID) ?? BUILTIN_TOOL_ENVIRONMENTS[0]!;
  }

  async upsert(req: UpsertToolEnvironmentRequest): Promise<ToolEnvironment> {
    const external = await this.listExternal();
    const id = (req.id ?? '').trim() || `ssh-${crypto.randomUUID().slice(0, 8)}`;
    if (BUILTIN_ENVIRONMENT_IDS.includes(id)) {
      throw new BadRequestException(`cannot use the built-in id "${id}" for a custom environment`);
    }
    if (req.id && !external.some((e) => e.id === id)) {
      throw new NotFoundException(`tool environment ${id} not found`);
    }
    const env: ToolEnvironment = { id, name: req.name.trim(), kind: 'ssh', builtin: false, ssh: req.ssh };
    const next = [...external.filter((e) => e.id !== id), env];
    await this.settings.setJson(TOOL_ENVIRONMENTS_SETTING_KEY, next);
    return env;
  }

  async remove(id: string): Promise<void> {
    if (BUILTIN_ENVIRONMENT_IDS.includes(id)) {
      throw new BadRequestException(`cannot delete the built-in environment "${id}"`);
    }
    const external = await this.listExternal();
    if (!external.some((e) => e.id === id)) throw new NotFoundException(`tool environment ${id} not found`);
    await this.settings.setJson(
      TOOL_ENVIRONMENTS_SETTING_KEY,
      external.filter((e) => e.id !== id),
    );
  }
}
