export type Gemma4ToolCall = {
  toolName: string;
  args: Record<string, string>;
};

const GEMMA_TOOL_CALL_RE = /<\|tool_call>call:([^({]+)\{(.*?)\}<tool_call\|>/gs;
const GEMMA_ARG_RE = /(\w+):(?:<\|"\|>(.*?)<\|"\|>|([^,}]*))/gs;

function castGemmaArgValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (lower === 'true' || lower === 'false') return lower;
  return trimmed.replace(/^['"]|['"]$/g, '');
}

export function parseGemma4ToolCallArgs(argsBody: string): Record<string, string> {
  const args: Record<string, string> = {};
  const body = String(argsBody ?? '');
  if (!body) return args;
  for (const match of body.matchAll(GEMMA_ARG_RE)) {
    const key = match[1];
    const quoted = match[2];
    const bare = match[3];
    const value = castGemmaArgValue(quoted ?? bare ?? '');
    if (key) args[key] = value;
  }
  return args;
}

export function parseGemma4ToolCalls(text: string): Gemma4ToolCall[] {
  const source = String(text ?? '');
  if (!source.includes('<|tool_call>')) return [];
  const calls: Gemma4ToolCall[] = [];
  for (const match of source.matchAll(GEMMA_TOOL_CALL_RE)) {
    const toolName = match[1]?.trim() ?? '';
    if (!toolName) continue;
    calls.push({
      toolName,
      args: parseGemma4ToolCallArgs(match[2] ?? ''),
    });
  }
  return calls;
}

export function gemmaArgsToToolRequest(args: Record<string, string>): string {
  const toolRequest = args.tool_request?.trim();
  if (toolRequest) return toolRequest;
  const entries = Object.entries(args).filter(([key]) => key !== 'source');
  if (entries.length === 0) return '';
  if (entries.length === 1) return entries[0][1];
  return entries.map(([key, value]) => `${key}: ${value}`).join(', ');
}

export function stripGemmaToolCallBlocks(text: string): string {
  return String(text ?? '')
    .replace(/<\|tool_call>[\s\S]*?<tool_call\|>/g, '')
    .replace(/<\|tool_response>[\s\S]*?(?:<tool_response\|>|$)/g, '')
    .replace(/<\|tool_call>[\s\S]*$/g, '')
    .trim();
}
