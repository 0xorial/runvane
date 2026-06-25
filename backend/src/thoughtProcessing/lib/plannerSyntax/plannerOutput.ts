/**
 * Pure helpers for turning planner replies into {@link ParsedPlannerOutput}.
 * Leaf module (no syntax-engine or provider imports) so the dialect providers
 * and the back-compat re-exports in `plannerTextParsing.ts` can both depend on
 * it without an import cycle.
 */

/** Canonical parsed planner reply: prose to show plus any requested tool calls. */
export type ParsedPlannerOutput = {
  assistantOutput: string;
  toolRequests: Array<{ toolName: string; toolRequest: string }>;
  followup: 'continue' | 'finalize';
};

/**
 * Pull the `assistant_output` string out of JSON-ish text by hand, tolerating
 * trailing junk or an unterminated object (streaming). Returns `''` if absent.
 */
export function extractAssistantOutputFromJsonLike(text: string): string {
  const source = String(text ?? '');
  if (!source) return '';
  const keyMatch = /"assistant_output"\s*:\s*"/.exec(source);
  if (!keyMatch) return '';
  let i = keyMatch.index + keyMatch[0].length;
  let out = '';
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"') return out;
    if (ch !== '\\') {
      out += ch;
      i += 1;
      continue;
    }
    const esc = source[i + 1];
    if (esc == null) return out;
    if (esc === '"' || esc === '\\' || esc === '/') {
      out += esc;
      i += 2;
      continue;
    }
    if (esc === 'b') { out += '\b'; i += 2; continue; }
    if (esc === 'f') { out += '\f'; i += 2; continue; }
    if (esc === 'n') { out += '\n'; i += 2; continue; }
    if (esc === 'r') { out += '\r'; i += 2; continue; }
    if (esc === 't') { out += '\t'; i += 2; continue; }
    if (esc === 'u') {
      const hex = source.slice(i + 2, i + 6);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) return out;
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 6;
      continue;
    }
    out += esc;
    i += 2;
  }
  return out;
}

/** Return the last balanced `{...}` object in `text`, or `null` if none ends it. */
export function extractLastBalancedJsonObject(text: string): string | null {
  const source = String(text ?? '');
  if (!source) return null;
  let end = source.length - 1;
  while (end >= 0 && /\s/.test(source[end])) end -= 1;
  if (end < 0 || source[end] !== '}') return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = end; i >= 0; i -= 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '}') { depth += 1; continue; }
    if (ch === '{') {
      depth -= 1;
      if (depth === 0) return source.slice(i, end + 1).trim();
    }
  }
  return null;
}

/** Strip a single leading/trailing ```` ``` ```` / ```` ```json ```` fence. */
export function stripFences(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/** Best-effort parse of a JSON object from possibly-fenced, possibly-trailing text. */
export function parseJsonObjectLoose(text: string): Record<string, unknown> | null {
  const stripped = stripFences(text);
  const candidates = [stripped, extractLastBalancedJsonObject(stripped) ?? ''];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

/** Read `tool_requests: [{ tool_name, tool_request }]` from a parsed JSON object. */
export function toolRequestsFromJson(obj: Record<string, unknown>): ParsedPlannerOutput['toolRequests'] {
  if (!Array.isArray(obj.tool_requests)) return [];
  return obj.tool_requests
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const row = item as { tool_name?: unknown; tool_request?: unknown };
      return {
        toolName: typeof row.tool_name === 'string' ? row.tool_name.trim() : '',
        toolRequest: typeof row.tool_request === 'string' ? row.tool_request : '',
      };
    })
    .filter((x) => x.toolName.length > 0);
}

/** Build a {@link ParsedPlannerOutput} from a parsed JSON planner object. */
export function plannerOutputFromJson(obj: Record<string, unknown>, reply: string): ParsedPlannerOutput {
  const assistantOutput =
    typeof obj.assistant_output === 'string' ? obj.assistant_output : extractAssistantOutputFromJsonLike(reply);
  return {
    assistantOutput,
    toolRequests: toolRequestsFromJson(obj),
    followup: obj.followup === 'continue' ? 'continue' : 'finalize',
  };
}

/** Fallback when no structured tool calls are found: treat the reply as prose. */
export function plainTextPlannerOutput(reply: string): ParsedPlannerOutput {
  return {
    assistantOutput: extractAssistantOutputFromJsonLike(reply) || stripFences(reply),
    toolRequests: [],
    followup: 'finalize',
  };
}
