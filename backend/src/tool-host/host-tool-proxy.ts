import {
  BaseTool,
  type RuleEvaluationResult,
  type ToolLocation,
  type ToolPermissionContext,
  type ToolPolicy,
  type ToolRunContext,
} from '../tools/base-tool.js';
import type { ToolSandboxKind } from '../contracts/tool-sandbox.js';
import type { HostToolDescriptor, InvocationResult } from './protocol.js';
import type { HostToolRulesProfile } from './host-tool-rules.js';

export type RouterInvokeOptions = { signal?: AbortSignal; onProgress?: (delta: string) => void };

/**
 * Routes a target tool to the tool-host for a given conversation's sandbox.
 * Implemented by ToolHostService; the proxy depends only on this interface.
 */
export interface ConversationToolRouter {
  sandboxKindForConversation(conversationId: string): Promise<ToolSandboxKind>;
  invokeForConversation(
    conversationId: string,
    toolName: string,
    params: unknown,
    opts: RouterInvokeOptions,
  ): Promise<InvocationResult>;
}

/**
 * Exposes a tool-host target tool to the harness as a BaseTool. Execution is
 * routed to the conversation's bound sandbox, so the same registered tool
 * runs locally, over ssh, or is forbidden (sandbox `none`) depending on the
 * conversation. Because run-tool.service runs `runTool` inside
 * `taskRegistry.run(...)`, monitoring and cancel propagation come for free.
 */
export class HostToolProxy extends BaseTool {
  constructor(
    private readonly router: ConversationToolRouter,
    private readonly descriptor: HostToolDescriptor,
    /** Optional governance for this specific host tool (rules + per-call
     *  permission logic). When present the proxy is safety-bearing. */
    private readonly profile?: HostToolRulesProfile,
  ) {
    super();
  }

  getLocation(): ToolLocation {
    return 'target';
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
    return this.profile ? this.profile.rulesSchema() : { type: 'object', properties: {}, additionalProperties: false };
  }

  getDefaultRules(): Record<string, unknown> {
    return this.profile ? this.profile.defaultRules() : {};
  }

  getDefaultPolicy(): ToolPolicy {
    // A governed proxy defaults to `custom` so its allowlist logic runs out of
    // the box; an ungoverned proxy keeps the safe `ask` default.
    return this.profile ? 'custom' : 'ask';
  }

  parseParams(raw: unknown): unknown {
    return raw;
  }

  parseRules(raw: unknown): Record<string, unknown> {
    if (this.profile) return this.profile.parseRules(raw);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  }

  async evaluatePermission(context: ToolPermissionContext<Record<string, unknown>>): Promise<RuleEvaluationResult[]> {
    const kind = await this.router.sandboxKindForConversation(context.conversationId);
    if (kind === 'none') {
      return [
        {
          ruleName: 'tool-sandbox',
          permission: 'forbid',
          detail: 'target tools are disabled for this conversation (sandbox: none)',
        },
      ];
    }
    // A governed proxy judges the specific call (e.g. an exec command allowlist);
    // an ungoverned one runs in the sandbox, so allow by default.
    if (this.profile) return this.profile.evaluate(context.params, context.rules);
    return [{ ruleName: 'tool-host', permission: 'allow', detail: `target tool (${kind})` }];
  }

  async runTool(params: unknown, context: ToolRunContext): Promise<unknown> {
    // A governed proxy may fill defaults (e.g. a working directory) before dispatch.
    const dispatchParams = this.profile ? this.profile.applyDefaults(params, (context.toolRules as Record<string, unknown>) ?? {}) : params;
    const result = await this.router.invokeForConversation(context.conversationId, this.descriptor.name, dispatchParams, {
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
