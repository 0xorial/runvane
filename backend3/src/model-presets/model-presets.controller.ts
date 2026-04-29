import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { UpsertModelPresetDto } from './dto/model-preset.dto.js';
import { ModelPresetsService } from './model-presets.service.js';

function parsePresetId(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new BadRequestException('invalid preset id');
  const id = Number(raw);
  if (!Number.isFinite(id)) throw new BadRequestException('invalid preset id');
  return id;
}

@Controller('api/model-presets')
export class ModelPresetsController {
  constructor(private readonly modelPresets: ModelPresetsService) {}

  @Get()
  async list() {
    return this.modelPresets.list();
  }

  @Post()
  async create(@Body() body: UpsertModelPresetDto) {
    return this.modelPresets.create(body);
  }

  @Get(':presetId')
  async get(@Param('presetId') presetIdRaw: string) {
    const row = await this.modelPresets.get(parsePresetId(presetIdRaw));
    if (!row) throw new NotFoundException('model preset not found');
    return row;
  }

  @Put(':presetId')
  async update(@Param('presetId') presetIdRaw: string, @Body() body: UpsertModelPresetDto) {
    const updated = await this.modelPresets.update(parsePresetId(presetIdRaw), body);
    if (!updated) throw new NotFoundException('model preset not found');
    return updated;
  }

  @Delete(':presetId')
  async delete(@Param('presetId') presetIdRaw: string) {
    const result = await this.modelPresets.delete(parsePresetId(presetIdRaw));
    if (result === 'not_found') throw new NotFoundException('model preset not found');
    return { ok: true };
  }
}
