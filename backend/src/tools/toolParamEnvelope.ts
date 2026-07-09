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
/**
 * Advertise the display-note slot on a tool's params JSON-Schema wherever the
 * PLANNER sees it (native tool specs, [direct args] schemas in the prompt):
 * an optional `tool_note` the model fills with a few words for the user.
 * `stripToolParamEnvelope` is the inverse — the note never reaches the tool.
 */
export function withToolNoteProperty(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const s = schema as Record<string, unknown>;
  const props =
    s.properties && typeof s.properties === 'object' && !Array.isArray(s.properties)
      ? (s.properties as Record<string, unknown>)
      : {};
  return {
    ...s,
    properties: {
      ...props,
      tool_note: {
        type: 'string',
        description:
          '3-6 plain words shown to the user next to this call, saying what it is for (e.g. "check current server time"). Not a tool argument.',
      },
    },
  };
}

export function stripToolParamEnvelope(params: unknown): unknown {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return params;
  const out = { ...(params as Record<string, unknown>) };
  if (typeof out.tool_request === 'string') delete out.tool_request;
  if (typeof out.tool_note === 'string') delete out.tool_note;
  if (out.source === 'planner_tool_request') delete out.source; // only our marker value
  if ('__tool_batch' in out) delete out.__tool_batch;
  return out;
}
