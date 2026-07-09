/**
 * Pure helpers for turning planner replies into {@link ParsedPlannerOutput}.
 * Leaf module (no syntax-engine or provider imports) so the dialect providers
 * and the back-compat re-exports in `plannerTextParsing.ts` can both depend on
 * it without an import cycle.
 */

/** Canonical parsed planner reply: prose to show plus any requested tool calls. */
export type ParsedPlannerOutput = {
  assistantOutput: string;
  /** `note`: the model's few-word purpose line for the call ("check current
   *  server time"), emitted in the same completion — the JSON dialect carries
   *  it; function-call dialects have no slot for it. */
  toolRequests: Array<{ toolName: string; toolRequest: string; note?: string }>;
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

/** Return the last balanced `open…close` span ending `text`, or `null` if none does. */
function extractLastBalancedJson(text: string, open: string, close: string): string | null {
  const source = String(text ?? '');
  if (!source) return null;
  let end = source.length - 1;
  while (end >= 0 && /\s/.test(source[end])) end -= 1;
  if (end < 0 || source[end] !== close) return null;

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
    if (ch === close) { depth += 1; continue; }
    if (ch === open) {
      depth -= 1;
      if (depth === 0) return source.slice(i, end + 1).trim();
    }
  }
  return null;
}

/** Return the last balanced `{...}` object in `text`, or `null` if none ends it. */
export function extractLastBalancedJsonObject(text: string): string | null {
  return extractLastBalancedJson(text, '{', '}');
}

/** Return the last balanced `[...]` array in `text`, or `null` if none ends it. */
export function extractLastBalancedJsonArray(text: string): string | null {
  return extractLastBalancedJson(text, '[', ']');
}

/** True once the first non-space char looks like the start of a JSON object or fence. */
export function looksLikeJsonStart(text: string): boolean {
  return /^\s*(```|\{)/.test(text);
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

/**
 * Best-effort parse of any JSON value (object OR array) from possibly-fenced,
 * possibly-trailing text. Used by the function-call dialects whose payload may
 * be a single call object or an array of them.
 */
export function parseJsonValueLoose(text: string): unknown {
  const stripped = stripFences(text);
  if (!stripped) return undefined;
  const candidates = [stripped, extractLastBalancedJsonObject(stripped), extractLastBalancedJsonArray(stripped)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

/**
 * Parse text that should be JSON *in its entirety* (after fence-stripping).
 * Unlike {@link parseJsonValueLoose} this does NOT extract an embedded value, so
 * a marker-prefixed payload like `[TOOL_CALLS] [...]` is rejected and left to its
 * own dialect. Returns `undefined` on any failure.
 */
export function parseJsonValueStrict(text: string): unknown {
  try {
    return JSON.parse(stripFences(text)) as unknown;
  } catch {
    return undefined;
  }
}

/** Read `tool_requests: [{ tool_name, tool_request, note? }]` from a parsed JSON object. */
export function toolRequestsFromJson(obj: Record<string, unknown>): ParsedPlannerOutput['toolRequests'] {
  if (!Array.isArray(obj.tool_requests)) return [];
  return obj.tool_requests
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const row = item as { tool_name?: unknown; tool_request?: unknown; note?: unknown };
      let note = typeof row.note === 'string' ? row.note.trim().slice(0, 120) : '';
      let toolRequest = typeof row.tool_request === 'string' ? row.tool_request : '';
      // [direct args] requests are params JSON; a model may deliver the note
      // inside them via the advertised `tool_note` slot instead of `note`.
      if (!note && (toolRequest.trimStart().startsWith('{'))) {
        try {
          const parsed = JSON.parse(toolRequest) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const inner = parsed as Record<string, unknown>;
            if (typeof inner.tool_note === 'string' && inner.tool_note.trim()) {
              note = inner.tool_note.trim().slice(0, 120);
              const { tool_note, ...rest } = inner;
              void tool_note;
              toolRequest = JSON.stringify(rest);
            }
          }
        } catch {
          // not valid JSON — leave the request as-is
        }
      }
      return {
        toolName: typeof row.tool_name === 'string' ? row.tool_name.trim() : '',
        toolRequest,
        ...(note ? { note } : {}),
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

// --- live streaming preview --------------------------------------------------

// Openers that mark the start of a tool-call block inside a plain-text planner
// reply: deepseek/DSML fullwidth-bar tokens, llama-style pipe tags, XML-ish
// function/invoke tags (anthropic, tool_call tags), mistral's [TOOL_CALLS],
// and gemma's ```tool_code fence.
const TOOL_CALL_OPENER =
  /<｜[^<>]*tool[^<>]*>|<\|[^<>|]*tool[^<>|]*\|>|<\s*(?:function_calls?|invoke|tool_call|tool_code)\b|\[TOOL_CALLS\]|```tool_code/i;

// Literal openers a streamed tail can be a prefix of (angle-tag openers are
// handled by shape instead — see heldTailLength).
const OPENER_PREFIX_TOKENS = ['[TOOL_CALLS]', '```tool_code'];

/**
 * Length of the suffix that might still grow into a tool-call opener and must
 * be withheld from the live preview (a half-received `<｜tool▁ca…` must not
 * flash in the user's bubble). Prose stays live: `a < b` or a closed tag stops
 * matching the opener shapes and is released on the next delta.
 */
function heldTailLength(text: string): number {
  const windowStart = Math.max(0, text.length - 64);
  for (let start = windowStart; start < text.length; start += 1) {
    const tail = text.slice(start);
    if (tail[0] === '<') {
      if (/^<[｜|]?[\w▁｜|/-]*$/.test(tail)) return tail.length;
      continue;
    }
    if (OPENER_PREFIX_TOKENS.some((token) => token.toLowerCase().startsWith(tail.toLowerCase()))) {
      return tail.length;
    }
    if (/^`{1,3}$/.test(tail)) return tail.length;
  }
  return 0;
}

/**
 * Extract the user-visible part of a *partially streamed* planner reply, for
 * the live assistant-message mirror. Handles both reply families:
 * JSON-syntax replies stream through the `assistant_output` field extractor;
 * plain-text replies (deepseek/gemma/llama answer style) stream as-is, cut at
 * the first tool-call opener with a possibly-half-received opener withheld.
 * Best-effort by design — the decision step overwrites the mirrored text with
 * the authoritative parse when the turn completes.
 */
export function extractAssistantPreviewFromStream(text: string): string {
  const raw = String(text ?? '');
  if (!raw) return '';
  // JSON planner replies (also fenced ones): the field extractor already
  // tolerates unterminated strings mid-stream.
  if (raw.includes('"assistant_output"')) return extractAssistantOutputFromJsonLike(raw);
  // Some local servers leave Qwen-style `<think>…</think>` blocks inline in the
  // text stream — never mirror them: drop closed blocks, cut at an open one
  // (a half-received `<thi` tail is withheld by heldTailLength below).
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const openThink = withoutThink.search(/<think>/i);
  const source = (openThink >= 0 ? withoutThink.slice(0, openThink) : withoutThink).replace(/^\s+/, '');
  if (!source) return '';
  // A structured reply is forming (object/fence first) but the output field
  // has not streamed yet — show nothing rather than raw braces.
  if (looksLikeJsonStart(source)) return '';
  const opener = TOOL_CALL_OPENER.exec(source);
  const visible = opener ? source.slice(0, opener.index) : source;
  if (opener) return visible.trimEnd();
  const held = heldTailLength(visible);
  return held > 0 ? visible.slice(0, visible.length - held) : visible;
}
