import type { LlmContentPart, LlmRequest } from './types.js';

/**
 * Pluggable byte source so the expander stays decoupled from the uploads
 * subsystem. The reason step wires {@link UploadsService.readContentById}.
 */
export type AttachmentByteSource = (attachmentId: string) => Promise<{
  filename: string;
  mime: string;
  bytes: Uint8Array;
} | null>;

function isImageMime(mime: string): boolean {
  return mime.toLowerCase().startsWith('image/');
}

async function expandPart(part: LlmContentPart, src: AttachmentByteSource): Promise<LlmContentPart> {
  if (part.kind !== 'attachment_ref') return part;
  const content = await src(part.attachmentId);
  if (!content) throw new Error(`attachment_ref expansion: missing content for ${part.attachmentId}`);
  const base64 = Buffer.from(content.bytes).toString('base64');
  const mime = part.mime || content.mime || 'application/octet-stream';
  if (isImageMime(mime)) {
    return { kind: 'image', mime, data: { base64 } };
  }
  return { kind: 'file', filename: part.filename || content.filename, mime, base64 };
}

/**
 * Replace every `attachment_ref` part with a fully-inlined `image`/`file`
 * part. Returns a new request; original is left untouched so the
 * editor/SSE-visible payload stays small.
 */
export async function expandAttachmentRefs(
  request: LlmRequest,
  src: AttachmentByteSource,
): Promise<LlmRequest> {
  const messages = await Promise.all(
    request.messages.map(async (m) => ({
      ...m,
      parts: await Promise.all(m.parts.map((p) => expandPart(p, src))),
    })),
  );
  return { ...request, messages };
}
