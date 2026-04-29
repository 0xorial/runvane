import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';

export class LlmProviderRowDto {
  @IsString()
  id!: string;

  @IsString()
  label!: string;

  @IsObject()
  settings!: Record<string, unknown>;

  @IsArray()
  @IsString({ each: true })
  models!: string[];

  @IsBoolean()
  models_verified!: boolean;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  settings_spec?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  quick_access_models?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabled_models?: string[];
}

export class LlmConfigurationDto {
  @IsString()
  provider_id!: string;

  @IsString()
  model_name!: string;

  @IsOptional()
  @IsString()
  tool_call_provider_id?: string;

  @IsOptional()
  @IsString()
  tool_call_model_name?: string;

  @IsObject()
  model_settings!: Record<string, unknown>;
}

export class PutLlmProviderSettingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LlmProviderRowDto)
  providers!: LlmProviderRowDto[];

  @ValidateNested()
  @Type(() => LlmConfigurationDto)
  llm_configuration!: LlmConfigurationDto;
}

export class LlmProviderConnectionTestDto {
  @IsString()
  provider_id!: string;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
