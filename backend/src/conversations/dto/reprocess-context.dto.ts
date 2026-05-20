import { IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { LlmRefDto } from './llm-ref.dto.js';

export class ReprocessContextDto {
  @IsString()
  @MinLength(1)
  editedRequestText!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LlmRefDto)
  llm?: LlmRefDto;
}
