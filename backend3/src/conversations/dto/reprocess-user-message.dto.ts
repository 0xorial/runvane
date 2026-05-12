import { IsString, MinLength } from 'class-validator';

export class ReprocessUserMessageDto {
  @IsString()
  @MinLength(1)
  editedText!: string;
}
