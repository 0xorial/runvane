import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class UpsertModelPresetDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}
