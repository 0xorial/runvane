import { IsString, MinLength } from 'class-validator';

export class SetDefaultViewLeafDto {
  @IsString()
  @MinLength(1)
  entryId!: string;
}
