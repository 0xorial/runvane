import { BaseTool } from "./baseTool.js";

export class ToolRegistry {
  private readonly byName = new Map<string, BaseTool>();

  register(tool: BaseTool): void {
    const name = String(tool.getName() || "").trim();
    if (!name) throw new Error("tool name is required");
    if (this.byName.has(name)) {
      throw new Error(`tool name collision: ${name}`);
    }
    this.byName.set(name, tool);
  }

  get(name: string): BaseTool | null {
    return this.byName.get(name) ?? null;
  }

  list(): BaseTool[] {
    return [...this.byName.values()];
  }
}
