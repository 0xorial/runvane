import { IsArray, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class PostConversationMessageDto {
  @IsString()
  @MinLength(1)
  message!: string;

  @IsString()
  @MinLength(1)
  agentId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  llmProviderId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  llmModel?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  modelPresetId?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachmentIds?: string[];
}
