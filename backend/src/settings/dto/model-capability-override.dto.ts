import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class ModelCapabilityOverrideDto {
  @IsString()
  provider_id!: string;

  @IsString()
  model_name!: string;

  @IsOptional()
  @IsBoolean()
  supports_image_input?: boolean | null;

  @IsOptional()
  @IsBoolean()
  supports_file_input?: boolean | null;

  @IsOptional()
  @IsNumber()
  max_context_tokens?: number | null;

  @IsOptional()
  @IsNumber()
  max_output_tokens?: number | null;

  @IsOptional()
  @IsNumber()
  input_cost_per_1m?: number | null;

  @IsOptional()
  @IsNumber()
  cached_input_cost_per_1m?: number | null;

  @IsOptional()
  @IsNumber()
  output_cost_per_1m?: number | null;

  @IsOptional()
  @IsString()
  currency?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsString()
  updated_by?: string | null;
}
