import { Injectable } from '@nestjs/common';
import { ModelPresetsRepo } from '../db/repositories/model-presets.repo.js';
import type { UpsertModelPresetDto } from './dto/model-preset.dto.js';

@Injectable()
export class ModelPresetsService {
  constructor(private readonly presets: ModelPresetsRepo) {}

  async list() {
    return this.presets.list();
  }

  async get(presetId: number) {
    return this.presets.get(presetId);
  }

  async create(input: UpsertModelPresetDto) {
    return this.presets.create({
      name: input.name ?? 'New preset',
      parameters: input.parameters ?? {},
    });
  }

  async update(presetId: number, input: UpsertModelPresetDto) {
    return this.presets.update(presetId, {
      name: input.name ?? 'New preset',
      parameters: input.parameters ?? {},
    });
  }

  async delete(presetId: number) {
    return this.presets.delete(presetId);
  }
}
