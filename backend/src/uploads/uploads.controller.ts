import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, type UploadFileResponse } from './uploads.types.js';
import { UploadsService } from './uploads.service.js';

@Controller('api/uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined): Promise<UploadFileResponse> {
    if (!file) throw new BadRequestException('multipart field `file` is required');
    if (file.size <= 0) throw new BadRequestException('file is empty');
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException(`file exceeds ${MAX_UPLOAD_LABEL} limit`);
    const attachment = await this.uploads.saveUpload({
      name: file.originalname,
      mimeType: file.mimetype || 'application/octet-stream',
      bytes: file.buffer,
    });
    return { attachment };
  }

  @Get(':uploadId/content')
  async readContent(@Param('uploadId') uploadId: string, @Res() res: Response) {
    const content = await this.uploads.readContentById(uploadId);
    if (!content) throw new NotFoundException('upload not found');
    res.setHeader('Content-Type', content.attachment.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(content.attachment.name)}"`);
    return res.send(Buffer.from(content.data));
  }
}
