import { Injectable } from '@nestjs/common';
import { UploadsRepo } from '../db/repositories/uploads.repo.js';

@Injectable()
export class UploadsService {
  constructor(private readonly uploads: UploadsRepo) {}

  async saveUpload(input: { name: string; mimeType: string; bytes: Uint8Array }) {
    return this.uploads.saveUpload(input);
  }

  async readContentById(uploadId: string) {
    return this.uploads.readContentById(uploadId);
  }
}
