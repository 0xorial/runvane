import { z } from 'zod';

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = '500MB';

export const UploadAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  createdAt: z.string(),
  url: z.string(),
});
export type UploadAttachment = z.infer<typeof UploadAttachmentSchema>;

export const UploadFileResponseSchema = z.object({
  attachment: UploadAttachmentSchema,
});
export type UploadFileResponse = z.infer<typeof UploadFileResponseSchema>;

export function uploadContentUrl(uploadId: string): string {
  return `/api/uploads/${uploadId}/content`;
}
