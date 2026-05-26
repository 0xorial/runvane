import { Injectable } from '@nestjs/common';
import type { AttachmentMode, ChatAttachment } from '../contracts/chatEntry.js';
import { UploadsRepo } from '../db/repositories/uploads.repo.js';
import { uploadContentUrl } from './uploads.types.js';

export type RequestedAttachment = { id: string; mode: AttachmentMode };

@Injectable()
export class UploadsService {
  constructor(private readonly uploads: UploadsRepo) {}

  async saveUpload(input: { name: string; mimeType: string; bytes: Uint8Array }) {
    return this.uploads.saveUpload(input);
  }

  async readContentById(uploadId: string) {
    return this.uploads.readContentById(uploadId);
  }

  /**
   * Resolve requested attachments (id + delivery mode) to persistable
   * `ChatAttachment` metadata for embedding on a user-message entry. Throws
   * if any id is missing — we never persist a phantom attachment id.
   */
  async resolveChatAttachments(requested: RequestedAttachment[]): Promise<ChatAttachment[]> {
    const out: ChatAttachment[] = [];
    for (const req of requested) {
      const content = await this.uploads.readContentById(req.id);
      if (!content) throw new Error(`upload not found: ${req.id}`);
      out.push({
        id: content.attachment.id,
        name: content.attachment.name,
        mimeType: content.attachment.mimeType,
        sizeBytes: content.attachment.sizeBytes,
        url: uploadContentUrl(content.attachment.id),
        mode: req.mode,
      });
    }
    return out;
  }
}
