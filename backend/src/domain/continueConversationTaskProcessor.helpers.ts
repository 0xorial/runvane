import { StreamInterruptedError, type StreamTextCompletionUsage } from "../llm_provider/provider.js";

export function incrementalDelta(prev: string, next: string): string {
  if (!next) return "";
  if (!prev) return next;
  if (next.startsWith(prev)) return next.slice(prev.length);
  const prefix = commonPrefixLen(prev, next);
  return next.slice(prefix);
}

function commonPrefixLen(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i += 1;
  return i;
}

export function extractAssistantOutputFromJsonLike(text: string): string {
  const source = String(text ?? "");
  if (!source) return "";
  const keyMatch = /"assistant_output"\s*:\s*"/.exec(source);
  if (!keyMatch) return "";
  let i = keyMatch.index + keyMatch[0].length;
  let out = "";
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"') return out;
    if (ch !== "\\") {
      out += ch;
      i += 1;
      continue;
    }
    const esc = source[i + 1];
    if (esc == null) return out;
    if (esc === '"' || esc === "\\" || esc === "/") {
      out += esc;
      i += 2;
      continue;
    }
    if (esc === "b") {
      out += "\b";
      i += 2;
      continue;
    }
    if (esc === "f") {
      out += "\f";
      i += 2;
      continue;
    }
    if (esc === "n") {
      out += "\n";
      i += 2;
      continue;
    }
    if (esc === "r") {
      out += "\r";
      i += 2;
      continue;
    }
    if (esc === "t") {
      out += "\t";
      i += 2;
      continue;
    }
    if (esc === "u") {
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

export function composeFailedPlannerResponse(partialReply: string): string {
  const partial = String(partialReply ?? "").trim();
  if (partial) return partial;
  return "";
}

export function usageFromStreamingError(error: unknown): StreamTextCompletionUsage | undefined {
  if (error instanceof StreamInterruptedError) {
    return error.usage;
  }
  if (!error || typeof error !== "object") return undefined;
  const usage = (error as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return undefined;
  }
  const usageRec = usage as Record<string, unknown>;
  const promptTokens = usageRec.promptTokens;
  const completionTokens = usageRec.completionTokens;
  const cachedPromptTokens = usageRec.cachedPromptTokens;
  if (
    typeof promptTokens !== "number" ||
    !Number.isFinite(promptTokens) ||
    typeof completionTokens !== "number" ||
    !Number.isFinite(completionTokens)
  ) {
    return undefined;
  }
  const normalized: StreamTextCompletionUsage = {
    promptTokens: Math.max(0, Math.trunc(promptTokens)),
    completionTokens: Math.max(0, Math.trunc(completionTokens)),
  };
  if (typeof cachedPromptTokens === "number" && Number.isFinite(cachedPromptTokens)) {
    normalized.cachedPromptTokens = Math.max(0, Math.trunc(cachedPromptTokens));
  }
  return normalized;
}

export function parseFirstJsonObjectCandidate(candidates: Array<string | null>): unknown | null {
  for (const candidate of candidates) {
    const raw = String(candidate ?? "").trim();
    if (!raw) continue;
    try {
      return JSON.parse(raw);
    } catch {
      // Try next candidate form.
    }
  }
  return null;
}

export function extractLastBalancedJsonObject(text: string): string | null {
  const source = String(text ?? "");
  if (!source) return null;
  let end = source.length - 1;
  while (end >= 0 && /\s/.test(source[end])) end -= 1;
  if (end < 0 || source[end] !== "}") return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = end; i >= 0; i -= 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "}") {
      depth += 1;
      continue;
    }
    if (ch === "{") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(i, end + 1).trim();
      }
      continue;
    }
  }
  return null;
}

export function parseJsonObjectFromCompletionText(input: {
  text: string;
  context: string;
}): Record<string, unknown> {
  const raw = String(input.text ?? "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${input.context}: invalid JSON`, { cause: e });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${input.context}: expected JSON object`);
  }
  return parsed as Record<string, unknown>;
}
