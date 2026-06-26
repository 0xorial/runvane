import { PROTOCOL_VERSION } from '../protocol/messages.ts';
import type { HarnessToHost, HostToolDescriptor, Invoke } from '../protocol/messages.ts';
import type { HostChannel } from '../transport/channel.ts';

/** Context handed to a target tool — mirrors runvane's `ToolRunContext`. */
export type TargetToolContext = {
  sessionId: string;
  invocationId: string;
  signal: AbortSignal;
  /** Stream incremental output (stdout, partial results) to the live tool row. */
  onProgress: (delta: string) => void;
};

export type TargetTool = {
  name: string;
  aiDescription: string;
  humanDescription: string;
  /** JSON Schema for the params. */
  paramsSchema: unknown;
  /** Optional validation/coercion; throw to reject bad params. */
  parseParams?: (raw: unknown) => unknown;
  run: (params: unknown, ctx: TargetToolContext) => Promise<unknown> | unknown;
};

export function describe(tool: TargetTool): HostToolDescriptor {
  return {
    name: tool.name,
    location: 'target',
    aiDescription: tool.aiDescription,
    humanDescription: tool.humanDescription,
    paramsSchema: tool.paramsSchema,
  };
}

/**
 * Serves target tools over a host channel: lists the catalog, runs
 * invocations with streamed progress, maps `cancel` onto an AbortController per
 * invocation, and answers pings. Holds no model/LLM state — pure execution.
 */
export class ToolHostServer {
  private readonly tools = new Map<string, TargetTool>();
  private readonly inflight = new Map<string, AbortController>();
  private readonly channel: HostChannel;

  constructor(channel: HostChannel, tools: TargetTool[]) {
    this.channel = channel;
    for (const tool of tools) this.tools.set(tool.name, tool);
  }

  register(tool: TargetTool): void {
    this.tools.set(tool.name, tool);
  }

  start(): void {
    this.channel.onMessage((msg) => this.handle(msg));
    this.channel.onClose(() => this.shutdown());
    this.channel.send({ type: 'ready', protocolVersion: PROTOCOL_VERSION });
  }

  private handle(msg: HarnessToHost): void {
    switch (msg.type) {
      case 'hello':
        return;
      case 'list_tools':
        this.channel.send({ type: 'tools', requestId: msg.requestId, tools: [...this.tools.values()].map(describe) });
        return;
      case 'invoke':
        void this.runInvocation(msg);
        return;
      case 'cancel':
        this.inflight.get(msg.invocationId)?.abort();
        return;
      case 'ping':
        this.channel.send({ type: 'pong', nonce: msg.nonce });
        return;
    }
  }

  private async runInvocation(msg: Invoke): Promise<void> {
    const startedAt = new Date();
    const tool = this.tools.get(msg.toolName);
    if (!tool) {
      this.finish(msg.invocationId, startedAt, false, null, `Unknown tool: ${msg.toolName}`);
      return;
    }

    const controller = new AbortController();
    this.inflight.set(msg.invocationId, controller);
    const onProgress = (delta: string): void => {
      if (delta) this.channel.send({ type: 'progress', invocationId: msg.invocationId, delta });
    };

    let output: unknown = null;
    let error: string | null = null;
    try {
      const params = tool.parseParams ? tool.parseParams(msg.params) : msg.params;
      output = await tool.run(params, {
        sessionId: msg.sessionId,
        invocationId: msg.invocationId,
        signal: controller.signal,
        onProgress,
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      this.inflight.delete(msg.invocationId);
    }
    this.finish(msg.invocationId, startedAt, error === null, error === null ? output : null, error);
  }

  private finish(invocationId: string, startedAt: Date, ok: boolean, output: unknown, error: string | null): void {
    const finishedAt = new Date();
    this.channel.send({
      type: 'result',
      invocationId,
      ok,
      output,
      error,
      timing: {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        elapsedMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      },
    });
  }

  private shutdown(): void {
    for (const controller of this.inflight.values()) controller.abort();
    this.inflight.clear();
  }
}
