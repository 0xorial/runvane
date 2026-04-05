import fs from "node:fs";
import path from "node:path";

import type { ChatAttachment } from "../../types/chatEntry.js";

type StoredUploadMeta = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
};

const DEFAULT_UPLOADS_DIR = path.resolve(process.cwd(), "data/uploads");

function safeFilename(name: string): string {
  const base = path.basename(name || "file");
  const cleaned = base.replace(/[^a-zA-Z0-9._ -]/g, "").trim();
  return cleaned || "file";
}

function isSafeId(id: string): boolean {
  return /^[a-zA-Z0-9-]{1,80}$/.test(id);
}

export function resolveUploadsDir(raw?: string): string {
  const p = String(raw || "").trim();
  return p ? path.resolve(p) : DEFAULT_UPLOADS_DIR;
}

export class UploadsRepo {
  constructor(private readonly baseDir: string) {
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  private binPath(id: string): string {
    return path.join(this.baseDir, `${id}.bin`);
  }

  private metaPath(id: string): string {
    return path.join(this.baseDir, `${id}.json`);
  }

  private toAttachment(meta: StoredUploadMeta): ChatAttachment {
    return {
      id: meta.id,
      name: meta.name,
      mimeType: meta.mimeType,
      sizeBytes: meta.sizeBytes,
      url: `/api/uploads/${encodeURIComponent(meta.id)}/content`,
    };
  }

  async saveUpload(input: {
    name: string;
    mimeType: string;
    bytes: ArrayBuffer;
  }): Promise<ChatAttachment> {
    const id = crypto.randomUUID();
    const safeName = safeFilename(input.name);
    const mimeType = String(input.mimeType || "application/octet-stream");
    const buffer = Buffer.from(input.bytes);
    const meta: StoredUploadMeta = {
      id,
      name: safeName,
      mimeType,
      sizeBytes: buffer.byteLength,
    };
    fs.writeFileSync(this.binPath(id), buffer);
    fs.writeFileSync(this.metaPath(id), JSON.stringify(meta));
    return this.toAttachment(meta);
  }

  getById(idRaw: string): ChatAttachment | null {
    const id = String(idRaw || "").trim();
    if (!isSafeId(id)) return null;
    const metaPath = this.metaPath(id);
    if (!fs.existsSync(metaPath)) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch {
      return null;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const rec = raw as Record<string, unknown>;
    const sizeBytes =
      typeof rec.sizeBytes === "number" && Number.isFinite(rec.sizeBytes)
        ? rec.sizeBytes
        : null;
    const meta: StoredUploadMeta | null =
      typeof rec.id === "string" &&
      typeof rec.name === "string" &&
      typeof rec.mimeType === "string" &&
      sizeBytes != null
        ? {
            id: rec.id,
            name: rec.name,
            mimeType: rec.mimeType,
            sizeBytes,
          }
        : null;
    if (!meta || meta.id !== id) return null;
    return this.toAttachment(meta);
  }

  readContentById(idRaw: string): { attachment: ChatAttachment; data: Buffer } | null {
    const attachment = this.getById(idRaw);
    if (!attachment) return null;
    const binPath = this.binPath(attachment.id);
    if (!fs.existsSync(binPath)) return null;
    return { attachment, data: fs.readFileSync(binPath) };
  }
}
