import {
  BaseTool,
  type RuleEvaluationResult,
  type ToolLocation,
  type ToolPermissionContext,
  type ToolRunContext,
} from '../tools/base-tool.js';
import type { ToolEnvironmentKind } from '../contracts/tool-environment.js';
import type { HostToolDescriptor, InvocationResult } from './protocol.js';

export type RouterInvokeOptions = { signal?: AbortSignal; onProgress?: (delta: string) => void };

/**
 * Routes a runtime tool to the tool-host for a given conversation's environment.
 * Implemented by ToolHostService; the proxy depends only on this interface.
 */
export interface ConversationToolRouter {
  environmentKindForConversation(conversationId: string): Promise<ToolEnvironmentKind>;
  invokeForConversation(
    conversationId: string,
    toolName: string,
    params: unknown,
    opts: RouterInvokeOptions,
  ): Promise<InvocationResult>;
}

/**
 * Exposes a tool-host runtime tool to the brain as a BaseTool. Execution is
 * routed to the conversation's bound environment, so the same registered tool
 * runs locally, over ssh, or is forbidden (environment `none`) depending on the
 * conversation. Because run-tool.service runs `runTool` inside
 * `taskRegistry.run(...)`, monitoring and cancel propagation come for free.
 */
export class HostToolProxy extends BaseTool {
  constructor(
    private readonly router: ConversationToolRouter,
    private readonly descriptor: HostToolDescriptor,
  ) {
    super();
  }

  getLocation(): ToolLocation {
    return 'runtime';
  }

  getName(): string {
    return this.descriptor.name;
  }

  getAiDescription(): string {
    return this.descriptor.aiDescription;
  }

  getHumanDescription(): string {
    return this.descriptor.humanDescription;
  }

  getParamsSchema(): unknown {
    return this.descriptor.paramsSchema;
  }

  getRulesSchema(): unknown {
    return { type: 'object', properties: {}, additionalProperties: false };
  }

  getDefaultRules(): Record<string, unknown> {
    return {};
  }

  parseParams(raw: unknown): unknown {
    return raw;
  }

  parseRules(raw: unknown): Record<string, unknown> {
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  }

  async evaluatePermission(context: ToolPermissionContext<Record<string, unknown>>): Promise<RuleEvaluationResult[]> {
    const kind = await this.router.environmentKindForConversation(context.conversationId);
    if (kind === 'none') {
      return [
        {
          ruleName: 'tool-environment',
          permission: 'forbid',
          detail: 'runtime tools are disabled for this conversation (environment: none)',
        },
      ];
    }
    // Runs in the sandbox, not on the host machine — allow by default; agents
    // can still tighten this per-tool via guardrails.
    return [{ ruleName: 'tool-host', permission: 'allow', detail: `runtime tool (${kind})` }];
  }

  async runTool(params: unknown, context: ToolRunContext): Promise<unknown> {
    const result = await this.router.invokeForConversation(context.conversationId, this.descriptor.name, params, {
      signal: context.signal,
      onProgress: context.onProgress,
    });
    if (!result.ok) {
      const err = new Error(result.error ?? 'tool-host invocation failed');
      // Surface cancellation as an AbortError so the planner treats it as
      // steering, not a tool failure (matches BashTool's behaviour).
      if (result.error === 'aborted') err.name = 'AbortError';
      throw err;
    }
    return result.output;
  }
}
