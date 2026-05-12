import { IsString, MinLength } from 'class-validator';

export class ReprocessReasonDto {
  @IsString()
  @MinLength(1)
  editedResponse!: string;
}
