import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  BaseTool,
  type RuleEvaluationResult,
  type ToolPermissionContext,
  type ToolRunContext,
} from '../../base-tool.js';
import { ToolRegistry } from '../../tool-registry.js';
import { zerialize } from 'zodex';
import { metaToolParamsSchema, parseMetaToolParams, type MetaToolParams } from './params.js';
import { MetaToolRulesSchema, parseMetaToolRules, type MetaToolRules } from './rules.js';

@Injectable()
export class MetaTool extends BaseTool<MetaToolParams, MetaToolRules> {
  constructor(private readonly moduleRef: ModuleRef) {
    super();
  }

  private get tools(): ToolRegistry {
    return this.moduleRef.get(ToolRegistry, { strict: false });
  }

  getName(): string {
    return 'meta';
  }

  getAiDescription(): string {
    return (
      'Introspect the runtime: list_tools, describe_tool(name), or conversation_summary. ' +
      'Use to discover available tools and inspect the current conversation context.'
    );
  }

  getHumanDescription(): string {
    return 'Runtime introspection (tools catalog and conversation summary).';
  }

  getParamsSchema(): unknown {
    return metaToolParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(MetaToolRulesSchema);
  }

  getDefaultRules(): MetaToolRules {
    return { allowed: 'always' };
  }

  parseParams(raw: unknown): MetaToolParams {
    return parseMetaToolParams(raw);
  }

  parseRules(raw: unknown): MetaToolRules {
    return parseMetaToolRules(raw);
  }

  evaluatePermission(context: ToolPermissionContext<MetaToolRules>): RuleEvaluationResult[] {
    const allowedRule = context.agentToolConfig.rules.allowed;
    const permission = allowedRule === 'always' ? 'allow' : allowedRule === 'never' ? 'forbid' : 'ask_user';
    return [{ ruleName: 'allowed', permission, detail: `Rule allowed='${allowedRule}'.` }];
  }

  runTool(params: MetaToolParams, context: ToolRunContext): unknown {
    switch (params.operation) {
      case 'list_tools':
        return {
          tools: this.tools.list().map((tool) => ({
            name: tool.getName(),
            description: tool.getAiDescription(),
          })),
        };
      case 'describe_tool': {
        if (!params.tool_name) throw new Error('meta.describe_tool requires tool_name');
        const tool = this.tools.get(params.tool_name);
        if (!tool) throw new Error(`meta: unknown tool ${params.tool_name}`);
        return {
          name: tool.getName(),
          description: tool.getAiDescription(),
          params_schema: tool.getParamsSchema(),
          default_rules: tool.getDefaultRules(),
        };
      }
      case 'conversation_summary': {
        const userMessages = context.entries.filter((entry) => entry.type === 'user-message');
        const assistantMessages = context.entries.filter((entry) => entry.type === 'assistant-message');
        const lastUser = userMessages[userMessages.length - 1];
        return {
          conversationId: context.conversationId,
          entryCount: context.entries.length,
          userMessageCount: userMessages.length,
          assistantMessageCount: assistantMessages.length,
          lastUserMessage: lastUser && lastUser.type === 'user-message' ? lastUser.text : null,
        };
      }
      default:
        throw new Error(`meta: unsupported operation ${params.operation as string}`);
    }
  }
}
