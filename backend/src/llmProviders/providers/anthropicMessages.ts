import type {
  ContentBlockParam,
  ImageBlockParam,
  MessageParam,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages.js';
import type { LlmContentPart, LlmMessage } from '../types.js';

/**
 * Canonical `LlmMessage[]` -> Anthropic Messages API `system` + `messages`.
 *
 * Shape rules this encodes (platform.claude.com docs, read 2026-10-17):
 *  - Leading `system` messages become the top-level `system` array; a `system`
 *    message that appears mid-conversation (e.g. a knowledge-retrieval note)
 *    becomes a `user` turn, because `role: "system"` inside `messages` is
 *    only accepted by some models.
 *  - Tool results live in `user` turns as `tool_result` blocks, immediately
 *    after the assistant `tool_use` turn, results first.
 *  - `thinking` history parts are dropped: replaying a thinking block needs
 *    its `signature`, which the canonical part does not carry. Omitting prior
 *    turns' thinking is allowed; inside a tool-use turn the API degrades to
 *    thinking-off for that request instead of erroring (adaptive mode).
 *  - Empty / whitespace-only text blocks are rejected by the API, so they
 *    are skipped; a message with nothing left is skipped too.
 */

export type AnthropicConversation = {
  system: TextBlockParam[];
  messages: MessageParam[];
};

export type ToolRendering = 'native' | 'text';

const IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

type ImageMediaType = ImageBlockParam['source'] extends infer S
  ? S extends { media_type: infer M }
    ? M
    : never
  : never;

function textBlock(text: string): TextBlockParam | null {
  if (!text.trim()) return null;
  return { type: 'text', text };
}

function stringifyPayload(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function isTextMime(mime: string): boolean {
  const m = mime.toLowerCase();
  return (
    m.startsWith('text/') ||
    m === 'application/json' ||
    m === 'application/xml' ||
    m === 'application/x-yaml' ||
    m === 'application/yaml'
  );
}

function imageBlock(part: Extract<LlmContentPart, { kind: 'image' }>): ImageBlockParam {
  if ('url' in part.data) {
    return { type: 'image', source: { type: 'url', url: part.data.url } };
  }
  const mediaType = part.mime.toLowerCase();
  if (!IMAGE_MEDIA_TYPES.has(mediaType)) {
    throw new Error(
      `anthropic: unsupported image type ${part.mime}; supported: image/jpeg, image/png, image/gif, image/webp`,
    );
  }
  return {
    type: 'image',
    source: { type: 'base64', media_type: mediaType as ImageMediaType, data: part.data.base64 },
  };
}

function fileBlock(part: Extract<LlmContentPart, { kind: 'file' }>): ContentBlockParam {
  const mime = part.mime.toLowerCase();
  if (mime === 'application/pdf') {
    return {
      type: 'document',
      title: part.filename,
      source: { type: 'base64', media_type: 'application/pdf', data: part.base64 },
    };
  }
  if (isTextMime(mime)) {
    return {
      type: 'document',
      title: part.filename,
      source: {
        type: 'text',
        media_type: 'text/plain',
        data: Buffer.from(part.base64, 'base64').toString('utf8'),
      },
    };
  }
  throw new Error(
    `anthropic: unsupported attachment "${part.filename}" (${part.mime}); supported: images, PDF, text files`,
  );
}

/** Text form of a tool call for conversations that carry no native tool definitions. */
export function toolCallAsText(part: Extract<LlmContentPart, { kind: 'tool_call' }>): string {
  return `<tool_call>${JSON.stringify({ name: part.toolName, arguments: part.args ?? {} })}</tool_call>`;
}

/** Text form of a tool result, paired with {@link toolCallAsText}. */
export function toolResultAsText(part: Extract<LlmContentPart, { kind: 'tool_result' }>): string {
  return `<tool_result call_id="${part.callId}" ok="${part.ok}">\n${stringifyPayload(part.payload)}\n</tool_result>`;
}

function userContent(parts: LlmContentPart[]): ContentBlockParam[] {
  const out: ContentBlockParam[] = [];
  for (const part of parts) {
    switch (part.kind) {
      case 'text': {
        const block = textBlock(part.text);
        if (block) out.push(block);
        break;
      }
      case 'image':
        out.push(imageBlock(part));
        break;
      case 'file':
        out.push(fileBlock(part));
        break;
      case 'attachment_ref':
        throw new Error('anthropic: attachment_ref must be expanded before reaching the provider');
      case 'tool_result':
        // Only reachable through a mis-roled message; keep the content visible.
        out.push({ type: 'text', text: toolResultAsText(part) });
        break;
      case 'tool_call':
      case 'thinking':
        break;
    }
  }
  return out;
}

function assistantContent(parts: LlmContentPart[], tools: ToolRendering): ContentBlockParam[] {
  const out: ContentBlockParam[] = [];
  for (const part of parts) {
    if (part.kind === 'text') {
      const block = textBlock(part.text);
      if (block) out.push(block);
      continue;
    }
    if (part.kind !== 'tool_call') continue; // thinking dropped (see header)
    if (tools === 'native') {
      out.push({ type: 'tool_use', id: part.callId, name: part.toolName, input: part.args ?? {} });
    } else {
      out.push({ type: 'text', text: toolCallAsText(part) });
    }
  }
  return out;
}

function toolTurnContent(parts: LlmContentPart[], tools: ToolRendering): ContentBlockParam[] {
  const out: ContentBlockParam[] = [];
  for (const part of parts) {
    if (part.kind !== 'tool_result') continue;
    if (tools === 'native') {
      out.push({
        type: 'tool_result',
        tool_use_id: part.callId,
        content: stringifyPayload(part.payload),
        ...(part.ok ? {} : { is_error: true }),
      });
    } else {
      out.push({ type: 'text', text: toolResultAsText(part) });
    }
  }
  return out;
}

function systemText(message: LlmMessage): string {
  const texts: string[] = [];
  for (const part of message.parts) {
    if (part.kind === 'text') {
      texts.push(part.text);
      continue;
    }
    throw new Error(`anthropic: system messages can only carry text (got ${part.kind})`);
  }
  return texts.join('\n');
}

/**
 * @param tools `'native'` maps tool_call/tool_result parts to `tool_use` /
 *   `tool_result` blocks (valid only when the request also defines `tools`);
 *   `'text'` renders them as text so a prompt-driven tool protocol (the
 *   planner's) round-trips without tool definitions.
 */
export function toAnthropicConversation(messages: LlmMessage[], tools: ToolRendering): AnthropicConversation {
  const system: TextBlockParam[] = [];
  const out: MessageParam[] = [];
  let leadingSystem = true;
  for (const m of messages) {
    if (m.role === 'system' && leadingSystem) {
      const block = textBlock(systemText(m));
      if (block) system.push(block);
      continue;
    }
    leadingSystem = false;
    let content: ContentBlockParam[];
    let role: MessageParam['role'];
    if (m.role === 'assistant') {
      role = 'assistant';
      content = assistantContent(m.parts, tools);
    } else if (m.role === 'tool') {
      role = 'user';
      content = toolTurnContent(m.parts, tools);
    } else {
      role = 'user';
      content = userContent(m.parts);
    }
    if (content.length === 0) continue;
    out.push({ role, content });
  }
  return { system, messages: out };
}
