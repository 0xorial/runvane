import { z } from "zod";
import { ChatAttachmentSchema } from "../types/chatEntry.js";

export type UploadFileResponse = {
  attachment: z.infer<typeof ChatAttachmentSchema>;
};
const UploadFileResponseSchema: z.ZodType<UploadFileResponse> = z.object({
  attachment: ChatAttachmentSchema,
});

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function isUploadFile(value: unknown): value is File {
  return value instanceof File;
}

export function toUploadFileResponse(attachment: UploadFileResponse["attachment"]): UploadFileResponse {
  return { attachment };
}

export function validateUploadFileResponse(data: unknown): UploadFileResponse {
  const parsed = UploadFileResponseSchema.safeParse(data);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `POST /api/uploads.${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new Error(`POST /api/uploads validation failed: ${details}`);
  }
  return parsed.data;
}
