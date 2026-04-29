import { IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class UpdateConversationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  groupId?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  newGroupName?: string;
}
