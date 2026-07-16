import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ModelCapabilityOverrideDto } from './dto/model-capability-override.dto.js';
import { LlmProviderConnectionTestDto, PutLlmProviderSettingsDto } from './dto/settings.dto.js';
import { SettingsService } from './settings.service.js';

@Controller('api/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('llm')
  async getLlm() {
    return this.settings.getLlmProviders();
  }

  @Get('llm_provider')
  async getLlmProvider() {
    return this.settings.getLlmProviderDocument();
  }

  @Put('llm_provider')
  async putLlmProvider(@Body() body: PutLlmProviderSettingsDto) {
    return this.settings.putLlmProviderDocument(body);
  }

  @Post('llm_provider/test_connection')
  async testConnection(@Body() body: LlmProviderConnectionTestDto) {
    return this.settings.testLlmProviderConnection(body);
  }

  @Get('model_capabilities')
  async getModelCapabilities() {
    return this.settings.listModelCapabilities();
  }

  @Get('model_pricing/live')
  async getLiveModelPricing(@Query('providerId') providerId?: string) {
    return this.settings.liveModelPricing(providerId ?? '');
  }

  @Put('model_capabilities/override')
  async putModelCapabilityOverride(@Body() body: ModelCapabilityOverrideDto) {
    return this.settings.upsertModelCapabilityOverride(body);
  }
}
