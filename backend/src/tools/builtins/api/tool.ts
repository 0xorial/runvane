import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AgentsService } from '../../../agents/agents.service.js';
import { ModelPresetsService } from '../../../model-presets/model-presets.service.js';
import { TaskRegistryService } from '../../../tasks/task-registry.service.js';
import { BaseTool, type ToolRunContext } from '../../base-tool.js';
import { describeToolCatalog, listToolCatalog } from '../../tool-catalog.api.js';
import { ToolRegistry } from '../../tool-registry.js';
import { zerialize } from 'zodex';
import { apiToolParamsSchema, parseApiToolParams, type ApiToolParams } from './params.js';
import { ApiToolRulesSchema, parseApiToolRules, type ApiToolRules } from './rules.js';

@Injectable()
export class ApiTool extends BaseTool<ApiToolParams, ApiToolRules> {
  constructor(private readonly moduleRef: ModuleRef) {
    super();
  }

  private get tools(): ToolRegistry {
    return this.moduleRef.get(ToolRegistry, { strict: false });
  }

  private get agents(): AgentsService {
    return this.moduleRef.get(AgentsService, { strict: false });
  }

  private get modelPresets(): ModelPresetsService {
    return this.moduleRef.get(ModelPresetsService, { strict: false });
  }

  private get tasks(): TaskRegistryService {
    return this.moduleRef.get(TaskRegistryService, { strict: false });
  }

  getName(): string {
    return 'api';
  }

  getAiDescription(): string {
    return (
      'Read-only introspection of the Runvane backend: discover tools, agents, model presets, and tasks. ' +
      'For chat history use the conversations tool.'
    );
  }

  getHumanDescription(): string {
    return 'Backend API introspection (tools, agents, presets, tasks).';
  }

  getParamsSchema(): unknown {
    return apiToolParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(ApiToolRulesSchema);
  }

  getDefaultRules(): ApiToolRules {
    return {};
  }

  parseParams(raw: unknown): ApiToolParams {
    return parseApiToolParams(raw);
  }

  parseRules(raw: unknown): ApiToolRules {
    return parseApiToolRules(raw);
  }

  async runTool(params: ApiToolParams, _context: ToolRunContext): Promise<unknown> {
    switch (params.operation) {
      case 'list_tools':
        return { tools: listToolCatalog(this.tools) };
      case 'describe_tool': {
        if (!params.tool_name) throw new Error('api.describe_tool requires tool_name');
        return { tool: describeToolCatalog(this.tools, params.tool_name) };
      }
      case 'list_agents':
        return { agents: await this.agents.list() };
      case 'get_agent': {
        if (!params.agent_id) throw new Error('api.get_agent requires agent_id');
        const agent = await this.agents.get(params.agent_id);
        if (!agent) throw new Error(`api: agent not found: ${params.agent_id}`);
        return { agent };
      }
      case 'list_model_presets':
        return { presets: await this.modelPresets.list() };
      case 'get_model_preset': {
        if (params.preset_id == null) throw new Error('api.get_model_preset requires preset_id');
        const preset = await this.modelPresets.get(params.preset_id);
        if (!preset) throw new Error(`api: model preset not found: ${params.preset_id}`);
        return { preset };
      }
      case 'list_tasks':
        return { tasks: this.tasks.list() };
      default:
        throw new Error(`api: unsupported operation ${params.operation as string}`);
    }
  }
}
