import { z } from 'zod';
import { UploadFileResponseSchema } from '../uploads/uploads.types.js';

export type { UploadFileResponse, UploadAttachment } from '../uploads/uploads.types.js';
export { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from '../uploads/uploads.types.js';

export function validateUploadFileResponse(data: unknown): z.infer<typeof UploadFileResponseSchema> {
  const parsed = UploadFileResponseSchema.safeParse(data);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `POST /api/uploads.${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new Error(`POST /api/uploads validation failed: ${details}`);
  }
  return parsed.data;
}
