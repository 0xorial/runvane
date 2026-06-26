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
   * Register a tool by name. Names are unique and a tool may never replace an
   * already-registered one — a collision throws. Safety invariant: a tool-host
   * proxy (which carries no rules/permission schema) must not be able to
   * silently supersede a safety-bearing builtin like `filesystem`.
   */
  register(tool: BaseTool): void {
    const name = tool.getName();
    if (!name) throw new Error('tool name is required');
    if (this.byName.has(name)) throw new Error(`tool name collision: ${name}`);
    this.byName.set(name, tool);
  }

  get(name: string): BaseTool | null {
    return this.byName.get(name) ?? null;
  }

  list(): BaseTool[] {
    return [...this.byName.values()];
  }
}
