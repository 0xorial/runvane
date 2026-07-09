import type { ToolInvocationEntry } from "@/protocol/chatEntry";

/**
 * A short model-authored line saying what a tool call is for, at zero extra
 * LLM cost:
 *
 * - Resolution-route calls: the planner's natural-language brief, written in
 *   the same planning turn and persisted as `parameters.tool_request`.
 * - Direct-args calls: `tool_request` is raw params JSON (not an explanation),
 *   so fall back to the most salient argument the model wrote — the query,
 *   url, path, command… — which is what a human skims for anyway.
 */
export function toolRequestBrief(entry: ToolInvocationEntry): string {
  const params = entry.parameters as Record<string, unknown>;
  const raw = params.tool_request;
  const requestText = typeof raw === "string" ? raw.trim() : "";
  const requestIsJson = requestText.startsWith("{") || requestText.startsWith("[");
  if (requestText && !requestIsJson) return requestText;

  const cleaned = stripEnvelope(params);
  const fromParams = salientParamValue(cleaned);
  if (fromParams) return fromParams;
  // Still resolving: the entry only carries the request JSON — mine that.
  if (requestIsJson) {
    try {
      const parsed = JSON.parse(requestText) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return salientParamValue(parsed as Record<string, unknown>);
      }
    } catch {
      return "";
    }
  }
  return "";
}

function stripEnvelope(params: Record<string, unknown>): Record<string, unknown> {
  const { tool_request, source, __tool_batch, ...rest } = params;
  void tool_request; void source; void __tool_batch;
  return rest;
}

/** Keys whose values read as "what this call is about", most telling first. */
const SALIENT_KEYS = ["request", "query", "url", "path", "command", "pattern", "text", "message", "prompt", "name"];

function salientParamValue(params: Record<string, unknown>): string {
  for (const key of SALIENT_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const value of Object.values(params)) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
