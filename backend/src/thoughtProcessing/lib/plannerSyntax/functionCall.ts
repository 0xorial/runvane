/**
 * Shared extraction for the "function call" family of dialects (Hermes/Qwen,
 * Mistral, Llama, OpenAI-style JSON). They all encode a call as some flavor of
 * `{ name, arguments }`; this normalizes the variations into the planner's
 * `{ toolName, toolRequest }` pairs.
 */
import type { ParsedPlannerOutput } from './plannerOutput.js';

/** Render call arguments into the free-text request the params step consumes. */
export function argsToToolRequest(args: unknown): string {
  if (args == null) return '';
  if (typeof args === 'string') return args; // already a JSON string (OpenAI) or prose
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Tool name from `name` / `tool_name` / OpenAI's nested `function.name`. */
function pickName(obj: Record<string, unknown>): string {
  const fn = asRecord(obj.function);
  for (const candidate of [obj.name, obj.tool_name, fn?.name]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
}

/** Args from `arguments` / `parameters` / `args` / `input` (or nested under `function`). */
function pickArgs(obj: Record<string, unknown>): unknown {
  const fn = asRecord(obj.function);
  if (fn && 'arguments' in fn) return fn.arguments;
  for (const key of ['arguments', 'parameters', 'args', 'input', 'tool_request']) {
    if (key in obj) return obj[key];
  }
  return undefined;
}

/**
 * Pull tool calls out of a parsed JSON value in any common shape: a single
 * `{name, arguments}` object, an array of them, or an OpenAI-style
 * `{tool_calls: [{function: {name, arguments}}]}` wrapper.
 */
export function extractFunctionCalls(root: unknown): ParsedPlannerOutput['toolRequests'] {
  const out: ParsedPlannerOutput['toolRequests'] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const obj = asRecord(value);
    if (!obj) return;
    if (Array.isArray(obj.tool_calls)) {
      visit(obj.tool_calls); // OpenAI / generic wrapper
      return;
    }
    const toolName = pickName(obj);
    if (toolName) out.push({ toolName, toolRequest: argsToToolRequest(pickArgs(obj)) });
  };
  visit(root);
  return out;
}
