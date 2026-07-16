import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AppSettingsRepo } from '../db/repositories/app-settings.repo.js';
import {
  BUILTIN_SANDBOX_IDS,
  BUILTIN_TOOL_SANDBOXES,
  DEFAULT_TOOL_SANDBOX_ID,
  TOOL_SANDBOXES_SETTING_KEY,
  ToolSandboxSchema,
  type ToolSandbox,
  type UpsertToolSandboxRequest,
} from '../contracts/tool-sandbox.js';

/**
 * Catalog of tool sandboxes: the two built-ins (`local`, `none`) plus the
 * user-defined `ssh` ones stored as a JSON blob in the settings table. A
 * conversation binds to one of these ids.
 */
@Injectable()
export class ToolSandboxesService {
  constructor(private readonly settings: AppSettingsRepo) {}

  async list(): Promise<ToolSandbox[]> {
    return [...BUILTIN_TOOL_SANDBOXES, ...(await this.listExternal())];
  }

  async listExternal(): Promise<ToolSandbox[]> {
    const raw = await this.settings.getJson<unknown>(TOOL_SANDBOXES_SETTING_KEY);
    if (!Array.isArray(raw)) return [];
    const out: ToolSandbox[] = [];
    for (const item of raw) {
      const parsed = ToolSandboxSchema.safeParse(item);
      // Only keep well-formed, non-builtin entries (builtins are code-defined).
      if (parsed.success && !parsed.data.builtin && !BUILTIN_SANDBOX_IDS.includes(parsed.data.id)) {
        out.push(parsed.data);
      }
    }
    return out;
  }

  async get(id: string): Promise<ToolSandbox | null> {
    return (await this.list()).find((e) => e.id === id) ?? null;
  }

  /** Resolve an id to a known sandbox, falling back to the default (local). */
  async getOrDefault(id: string | null | undefined): Promise<ToolSandbox> {
    const all = await this.list();
    const found = id ? all.find((e) => e.id === id) : undefined;
    return found ?? all.find((e) => e.id === DEFAULT_TOOL_SANDBOX_ID) ?? BUILTIN_TOOL_SANDBOXES[0]!;
  }

  async upsert(req: UpsertToolSandboxRequest): Promise<ToolSandbox> {
    const external = await this.listExternal();
    const id = (req.id ?? '').trim() || `ssh-${crypto.randomUUID().slice(0, 8)}`;
    if (BUILTIN_SANDBOX_IDS.includes(id)) {
      throw new BadRequestException(`cannot use the built-in id "${id}" for a custom sandbox`);
    }
    if (req.id && !external.some((e) => e.id === id)) {
      throw new NotFoundException(`tool sandbox ${id} not found`);
    }
    // An update keeps the docker linkage (renaming a docker sandbox must not
    // orphan its container at delete time).
    const existing = external.find((e) => e.id === id);
    const env: ToolSandbox = {
      id,
      name: req.name.trim(),
      kind: 'ssh',
      builtin: false,
      ssh: req.ssh,
      docker: existing?.docker ?? null,
    };
    const next = [...external.filter((e) => e.id !== id), env];
    await this.settings.setJson(TOOL_SANDBOXES_SETTING_KEY, next);
    return env;
  }

  /** Store a fully-built non-builtin row (docker sandboxes are assembled by
   *  SandboxContainersService; this only persists). Replaces any row with
   *  the same id. */
  async saveRow(env: ToolSandbox): Promise<ToolSandbox> {
    if (BUILTIN_SANDBOX_IDS.includes(env.id) || env.builtin) {
      throw new BadRequestException(`cannot store a builtin sandbox id "${env.id}"`);
    }
    const parsed = ToolSandboxSchema.parse(env);
    const external = await this.listExternal();
    await this.settings.setJson(TOOL_SANDBOXES_SETTING_KEY, [...external.filter((e) => e.id !== parsed.id), parsed]);
    return parsed;
  }

  async remove(id: string): Promise<void> {
    if (BUILTIN_SANDBOX_IDS.includes(id)) {
      throw new BadRequestException(`cannot delete the built-in sandbox "${id}"`);
    }
    const external = await this.listExternal();
    if (!external.some((e) => e.id === id)) throw new NotFoundException(`tool sandbox ${id} not found`);
    await this.settings.setJson(
      TOOL_SANDBOXES_SETTING_KEY,
      external.filter((e) => e.id !== id),
    );
  }
}
