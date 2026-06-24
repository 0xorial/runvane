import {
  BaseTool,
  type RuleEvaluationResult,
  type ToolLocation,
  type ToolRunContext,
} from '../tools/base-tool.js';
import type { HostToolDescriptor } from './protocol.js';
import type { ToolHostClient } from './tool-host-client.js';

/**
 * Exposes a tool-host runtime tool to the brain as a BaseTool. `runTool`
 * delegates over the wire with the run context's signal + onProgress, so
 * run-tool.service runs it inside `taskRegistry.run(...)` exactly like a local
 * tool — giving running-tasks monitoring and cancel propagation for free.
 */
export class HostToolProxy extends BaseTool {
  constructor(
    private readonly client: ToolHostClient,
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

  evaluatePermission(): RuleEvaluationResult[] {
    // The tool runs in the sandbox, not on the host machine, so allow by
    // default. Agents can still tighten this per-tool via guardrails.
    return [{ ruleName: 'tool-host', permission: 'allow', detail: 'runtime tool (sandboxed)' }];
  }

  async runTool(params: unknown, context: ToolRunContext): Promise<unknown> {
    const result = await this.client.invoke(this.descriptor.name, params, {
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
