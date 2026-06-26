import type { INestApplication } from '@nestjs/common';
import { z } from 'zod';
import { zerialize } from 'zodex';
import { BaseTool, type ToolRunContext } from '../../../backend/src/tools/base-tool.js';
import { ToolRegistry } from '../../../backend/src/tools/tool-registry.js';
import { MOCK_FANOUT_TOOL_NAMES } from '../../../backend/src/llmProviders/providers/stubLlm.helpers.js';

type Outcome = { kind: 'ok'; output: unknown } | { kind: 'error'; message: string };

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Test-side handle for the mock tools. Gives a spec full, timing-deterministic
 * control over each mock tool invocation: the tool blocks inside `runTool`
 * until the spec releases it via {@link complete} / {@link fail}, so completion
 * ORDER is decided by the test, not by real timers or scheduling races.
 */
export class MockToolController {
  private readonly started = new Map<string, Deferred<void>>();
  private readonly release = new Map<string, Deferred<Outcome>>();

  private startedGate(name: string): Deferred<void> {
    let d = this.started.get(name);
    if (!d) {
      d = deferred<void>();
      this.started.set(name, d);
    }
    return d;
  }

  private releaseGate(name: string): Deferred<Outcome> {
    let d = this.release.get(name);
    if (!d) {
      d = deferred<Outcome>();
      this.release.set(name, d);
    }
    return d;
  }

  /** Called by MockTool.runTool: mark the tool started, then block until released. */
  async run(name: string, signal: AbortSignal): Promise<unknown> {
    this.startedGate(name).resolve();
    const aborted = new Promise<never>((_, reject) => {
      if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
      else signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    const outcome = await Promise.race([this.releaseGate(name).promise, aborted]);
    if (outcome.kind === 'error') throw new Error(outcome.message);
    return outcome.output;
  }

  /** Resolves once the named tool has entered execution (its runTool was called). */
  async waitForStart(name: string): Promise<void> {
    await this.startedGate(name).promise;
  }

  /** Release a started (or soon-to-start) tool to complete successfully. */
  complete(name: string, output: unknown = { ok: true, tool: name }): void {
    this.releaseGate(name).resolve({ kind: 'ok', output });
  }

  /** Release a started (or soon-to-start) tool to fail (its runTool throws). */
  fail(name: string, message = `mock ${name} failed`): void {
    this.releaseGate(name).resolve({ kind: 'error', message });
  }

  reset(): void {
    this.started.clear();
    this.release.clear();
  }
}

const MockRulesSchema = z.object({});
type MockRules = z.infer<typeof MockRulesSchema>;

/**
 * A controllable tool used by the fan-out integration tests. Behavior (timing,
 * success/failure) is delegated to a shared {@link MockToolController}; the
 * `policy` + `guardrail` come from the per-message tool overrides.
 */
export class MockTool extends BaseTool<Record<string, never>, MockRules> {
  constructor(
    private readonly toolName: string,
    private readonly controller: MockToolController,
  ) {
    super();
  }

  getName(): string {
    return this.toolName;
  }
  getAiDescription(): string {
    return `Mock tool ${this.toolName} for fan-out integration tests.`;
  }
  getHumanDescription(): string {
    return `Mock ${this.toolName}.`;
  }
  getParamsSchema(): unknown {
    return zerialize(z.object({}));
  }
  getRulesSchema(): unknown {
    return zerialize(MockRulesSchema);
  }
  getDefaultRules(): MockRules {
    return {};
  }
  parseParams(): Record<string, never> {
    return {};
  }
  parseRules(raw: unknown): MockRules {
    return MockRulesSchema.parse(raw ?? {});
  }
  runTool(_params: Record<string, never>, context: ToolRunContext): Promise<unknown> {
    return this.controller.run(this.toolName, context.signal);
  }
}

/** Register the three mock tools into the running app's registry (idempotent). */
export function registerMockTools(app: INestApplication, controller: MockToolController): void {
  const registry = app.get(ToolRegistry);
  for (const name of MOCK_FANOUT_TOOL_NAMES) {
    registry.register(new MockTool(name, controller), { override: true });
  }
}
