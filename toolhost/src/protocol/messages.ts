/**
 * The wire contract between the brain (client) and a tool-host (server).
 *
 * Transport-agnostic: these objects are serialized as NDJSON over whatever
 * duplex byte stream a transport provides (in-process, child stdio, ssh).
 * See ../../docs/protocol.md.
 */

export const PROTOCOL_VERSION = 1;

/** A single tool the host can run. Mirrors the brain's tool descriptor shape. */
export type HostToolDescriptor = {
  name: string;
  /** Host tools always run in the sandbox. */
  runtime: 'runtime';
  aiDescription: string;
  humanDescription: string;
  /** JSON Schema for the tool params (LLM + validation). */
  paramsSchema: unknown;
};

/** Final outcome of a tool invocation. */
export type InvocationResult = {
  ok: boolean;
  output: unknown;
  error: string | null;
  timing: { startedAt: string; finishedAt: string; elapsedMs: number };
};

// ─── brain → host ────────────────────────────────────────────────────────────

export type Hello = { type: 'hello'; protocolVersion: number };
export type ListTools = { type: 'list_tools'; requestId: string };
export type Invoke = {
  type: 'invoke';
  invocationId: string;
  sessionId: string;
  toolName: string;
  params: unknown;
};
export type Cancel = { type: 'cancel'; invocationId: string };
export type Ping = { type: 'ping'; nonce: string };

export type BrainToHost = Hello | ListTools | Invoke | Cancel | Ping;

// ─── host → brain ────────────────────────────────────────────────────────────

export type Ready = { type: 'ready'; protocolVersion: number };
export type ToolsList = { type: 'tools'; requestId: string; tools: HostToolDescriptor[] };
export type Progress = { type: 'progress'; invocationId: string; delta: string };
export type Result = { type: 'result'; invocationId: string } & InvocationResult;
export type Pong = { type: 'pong'; nonce: string };
export type HostError = { type: 'error'; invocationId: string | null; message: string };

export type HostToBrain = Ready | ToolsList | Progress | Result | Pong | HostError;

export type AnyMessage = BrainToHost | HostToBrain;

/** Narrow an unknown parsed value to a message with a string `type`. */
export function isMessage(value: unknown): value is { type: string } {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
