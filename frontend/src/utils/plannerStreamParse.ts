/** Best-effort partial `content` string for streamed `{"action":"final_answer","content":"…`. */
export function extractStreamingFinalAnswerContent(buffer: string): string | null {
  if (typeof buffer !== "string" || !buffer.includes('"content"')) return null;
  const re = /"content"\s*:\s*"/;
  const m = re.exec(buffer);
  if (!m) return null;
  let i = m.index + m[0].length;
  let out = "";
  for (; i < buffer.length; i++) {
    const ch = buffer[i];
    if (ch === '"') break;
    if (ch === "\\" && i + 1 < buffer.length) {
      const n = buffer[i + 1];
      if (n === "n") {
        out += "\n";
        i++;
        continue;
      }
      if (n === "t") {
        out += "\t";
        i++;
        continue;
      }
      if (n === "r") {
        out += "\r";
        i++;
        continue;
      }
      out += n;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

export function isStreamingFinalAnswer(buffer: string): boolean {
  return typeof buffer === "string" && /"action"\s*:\s*"final_answer"/.test(buffer);
}

/** Partial tool name while streaming `tool_call` JSON. */
export function extractStreamingToolCallName(buffer: string): string | null {
  if (typeof buffer !== "string" || !/"action"\s*:\s*"tool_call"/.test(buffer)) return null;
  const m = /"tool"\s*:\s*"([^"]*)/.exec(buffer);
  return m ? m[1] : null;
}
