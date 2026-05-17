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

function stripFences(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

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

export type ParsedPlannerOutput = {
  assistantOutput: string;
  toolRequests: Array<{ toolName: string; toolRequest: string }>;
  followup: 'continue' | 'finalize';
};

export function parsePlannerOutput(reply: string): ParsedPlannerOutput {
  const obj = parseJsonObjectLoose(reply);
  if (!obj) {
    return {
      assistantOutput: extractAssistantOutputFromJsonLike(reply) || stripFences(reply),
      toolRequests: [],
      followup: 'finalize',
    };
  }
  const assistantOutput =
    typeof obj.assistant_output === 'string' ? obj.assistant_output : extractAssistantOutputFromJsonLike(reply);
  const toolRequests = Array.isArray(obj.tool_requests)
    ? obj.tool_requests
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => {
          const row = item as { tool_name?: unknown; tool_request?: unknown };
          return {
            toolName: typeof row.tool_name === 'string' ? row.tool_name.trim() : '',
            toolRequest: typeof row.tool_request === 'string' ? row.tool_request : '',
          };
        })
        .filter((x) => x.toolName.length > 0)
    : [];
  return {
    assistantOutput,
    toolRequests,
    followup: obj.followup === 'continue' ? 'continue' : 'finalize',
  };
}
