import type { BaseTool, ToolLocation } from './base-tool.js';
import { ToolRegistry } from './tool-registry.js';

export type ToolCatalogRow = {
  name: string;
  description: string;
  ai_description: string;
  params_schema: unknown;
  rules_schema: unknown;
  default_rules: unknown;
  location: ToolLocation;
};

export function toToolCatalogRow(tool: BaseTool): ToolCatalogRow {
  return {
    name: tool.getName(),
    description: tool.getHumanDescription(),
    ai_description: tool.getAiDescription(),
    params_schema: tool.getParamsSchema(),
    rules_schema: tool.getRulesSchema(),
    default_rules: tool.getDefaultRules(),
    location: tool.getLocation(),
  };
}

export function listToolCatalog(tools: ToolRegistry): ToolCatalogRow[] {
  return tools.list().map((tool) => toToolCatalogRow(tool));
}

export function describeToolCatalog(tools: ToolRegistry, toolName: string): ToolCatalogRow {
  const tool = tools.get(toolName);
  if (!tool) throw new Error(`api: unknown tool ${toolName}`);
  return toToolCatalogRow(tool);
}
