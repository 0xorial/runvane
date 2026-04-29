import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import type { UploadAttachment } from '../../uploads/uploads.types.js';

type UploadDbRow = {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  content: Uint8Array;
  created_at: string;
};

function toUploadAttachment(row: UploadDbRow): UploadAttachment {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

@Injectable()
export class UploadsRepo {
  constructor(private readonly prisma: PrismaService) {}

  async saveUpload(input: { name: string; mimeType: string; bytes: Uint8Array }): Promise<UploadAttachment> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO uploads (id, name, mime_type, size_bytes, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      input.name,
      input.mimeType,
      input.bytes.byteLength,
      Buffer.from(input.bytes),
      now,
    );
    const row = await this.readContentById(id);
    if (!row) throw new Error('failed to load inserted upload');
    return row.attachment;
  }

  async readContentById(uploadId: string): Promise<{ attachment: UploadAttachment; data: Uint8Array } | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT id, name, mime_type, size_bytes, content, created_at
       FROM uploads
       WHERE id = ?`,
      uploadId,
    )) as UploadDbRow[];
    const row = rows[0];
    if (!row) return null;
    return {
      attachment: toUploadAttachment(row),
      data: row.content,
    };
  }
}
