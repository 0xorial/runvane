export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadAttachment = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export type UploadFileResponse = {
  attachment: UploadAttachment;
};
