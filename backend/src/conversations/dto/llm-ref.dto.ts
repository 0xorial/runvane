import { IsString, MinLength } from 'class-validator';

/** Request-body shape for an LLM reference. Mirrors the `LlmRef` contract type. */
export class LlmRefDto {
  @IsString()
  @MinLength(1)
  providerId!: string;

  @IsString()
  @MinLength(1)
  model!: string;
}
