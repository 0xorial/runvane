import { Inject, Injectable } from '@nestjs/common';
import { BaseTool } from './base-tool.js';

export const TOOL_TOKEN = Symbol('TOOL_TOKEN');

@Injectable()
export class ToolRegistry {
  private readonly byName = new Map<string, BaseTool>();

  constructor(@Inject(TOOL_TOKEN) tools: BaseTool[]) {
    for (const tool of tools) this.register(tool);
  }

  /**
   * Register a tool by name. Names are unique, so a collision throws — except
   * when `override` is set, which lets a tool-host runtime tool supersede a
   * same-named builtin (e.g. the sandbox `filesystem` replaces the in-brain one
   * when a host is connected, falling back to the builtin when it isn't).
   */
  register(tool: BaseTool, options?: { override?: boolean }): void {
    const name = tool.getName();
    if (!name) throw new Error('tool name is required');
    if (this.byName.has(name) && !options?.override) throw new Error(`tool name collision: ${name}`);
    this.byName.set(name, tool);
  }

  get(name: string): BaseTool | null {
    return this.byName.get(name) ?? null;
  }

  list(): BaseTool[] {
    return [...this.byName.values()];
  }
}
