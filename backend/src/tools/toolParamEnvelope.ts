/**
 * Internal envelope keys runvane stamps onto a stored tool-invocation's
 * `parameters` (see RunToolService.toParametersPayload): the planner's raw
 * `tool_request`, its `source` marker, and the fan-out `__tool_batch`. They
 * are bookkeeping, not tool arguments — strip them wherever params flow back
 * into a tool's strict schema or into an LLM context. Models imitate whatever
 * argument shape their context shows: a glm-5.2 run once looped through 15
 * silent planning rounds because it echoed these keys from replayed context
 * turns and the strict param schema rejected every dispatch.
 */
export function stripToolParamEnvelope(params: unknown): unknown {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  const out = { ...(params as Record<string, unknown>) };
  if (typeof out.tool_request === 'string') delete out.tool_request;
  if (out.source === 'planner_tool_request') delete out.source; // only our marker value
  if ('__tool_batch' in out) delete out.__tool_batch;
  return out;
}
