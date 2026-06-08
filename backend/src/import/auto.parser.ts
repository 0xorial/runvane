import { parseClaudeExport } from './claude.parser.js';
import { parseGeminiExport } from './gemini.parser.js';
import { parseGrokExport } from './grok.parser.js';
import { parseOpenAiExport } from './openai.parser.js';
import type { NormalizedImportConversation } from './types.js';

type ImportParser = (raw: unknown) => NormalizedImportConversation[];

const PARSERS: Array<{ name: string; parse: ImportParser }> = [
  { name: 'claude', parse: parseClaudeExport },
  { name: 'grok', parse: parseGrokExport },
  { name: 'gemini', parse: parseGeminiExport },
  { name: 'openai', parse: parseOpenAiExport },
];

export function parseAutoImport(raw: unknown): { format: string; conversations: NormalizedImportConversation[] } {
  const errors: string[] = [];
  for (const { name, parse } of PARSERS) {
    try {
      const conversations = parse(raw);
      if (conversations.length > 0) return { format: name, conversations };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      errors.push(`${name}: ${detail}`);
    }
  }
  throw new Error(`import auto-detect failed: ${errors.join(' | ')}`);
}
