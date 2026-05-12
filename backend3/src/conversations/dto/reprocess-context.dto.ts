import { IsOptional, IsString, MinLength } from 'class-validator';

export class ReprocessContextDto {
  @IsString()
  @MinLength(1)
  editedRequestText!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  llmProviderId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  llmModel?: string;
}
