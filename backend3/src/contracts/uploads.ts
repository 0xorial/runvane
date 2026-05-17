import { z } from 'zod';

// Re-export from uploads.types.ts
export type { UploadFileResponse, UploadAttachment } from '../uploads/uploads.types.js';
export { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from '../uploads/uploads.types.js';

import type { UploadFileResponse } from '../uploads/uploads.types.js';

const UploadAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  createdAt: z.string(),
  url: z.string(),
});

const UploadFileResponseSchema: z.ZodType<UploadFileResponse> = z.object({
  attachment: UploadAttachmentSchema,
});

export function validateUploadFileResponse(data: unknown): UploadFileResponse {
  const parsed = UploadFileResponseSchema.safeParse(data);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `POST /api/uploads.${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new Error(`POST /api/uploads validation failed: ${details}`);
  }
  return parsed.data;
}
