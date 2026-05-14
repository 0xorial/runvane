export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = '500MB';

export type UploadAttachment = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  /** Stable GET endpoint for the upload's bytes, served by UploadsController. */
  url: string;
};

export type UploadFileResponse = {
  attachment: UploadAttachment;
};

export function uploadContentUrl(uploadId: string): string {
  return `/api/uploads/${uploadId}/content`;
}
