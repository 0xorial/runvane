import type { HostToolDescriptor } from '../protocol/messages.ts';
import type { ToolLocation } from '../protocol/tools.ts';
import type { ToolHostClient } from './client.ts';

export type ProxyRunContext = {
  signal: AbortSignal;
  onProgress?: (delta: string) => void;
  sessionId?: string;
};

/**
 * A framework-neutral view of a host tool the harness can register. Adapt it to a
 * runvane BaseTool by forwarding `runTool(params, ctx)` → `run(params, ctx)`;
 * because the harness runs that inside `taskRegistry.run(...)`, the remote run
 * shows up in monitoring and a task cancel propagates to the host.
 */
export type HarnessToolProxy = {
  name: string;
  location: ToolLocation;
  aiDescription: string;
  humanDescription: string;
  paramsSchema: unknown;
  run: (params: unknown, ctx: ProxyRunContext) => Promise<unknown>;
};

export function createTargetToolProxy(client: ToolHostClient, descriptor: HostToolDescriptor): HarnessToolProxy {
  return {
    name: descriptor.name,
    location: 'target',
    aiDescription: descriptor.aiDescription,
    humanDescription: descriptor.humanDescription,
    paramsSchema: descriptor.paramsSchema,
    async run(params, ctx) {
      const result = await client.invoke(descriptor.name, params, {
        signal: ctx.signal,
        onProgress: ctx.onProgress,
        sessionId: ctx.sessionId,
      });
      if (!result.ok) {
        const err = new Error(result.error ?? 'tool-host invocation failed');
        // Let the harness treat cancellation as an abort rather than a tool error.
        if (result.error === 'aborted') err.name = 'AbortError';
        throw err;
      }
      return result.output;
    },
  };
}

/** Build a proxy per descriptor (typically the result of `client.listTools()`). */
export function createTargetToolProxies(client: ToolHostClient, descriptors: HostToolDescriptor[]): HarnessToolProxy[] {
  return descriptors.map((d) => createTargetToolProxy(client, d));
}
