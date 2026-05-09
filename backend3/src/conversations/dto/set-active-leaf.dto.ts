import { IsString, MinLength } from 'class-validator';

export class SetActiveLeafDto {
  @IsString()
  @MinLength(1)
  entryId!: string;
}
