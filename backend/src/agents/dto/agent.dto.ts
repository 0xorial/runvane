import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { AgentDefaultLlmConfiguration } from '../agent.entity.js';

// Compile-time check: AgentDefaultLlmConfigurationDto must be structurally
// assignable to AgentDefaultLlmConfiguration. If a field is added to the
// schema and forgotten here, agents.service.ts will fail to compile.
type _DtoMatchesEntity = AgentDefaultLlmConfigurationDto extends AgentDefaultLlmConfiguration ? true : never;

export class AgentModelReferenceDto {
  @IsOptional()
  @IsString()
  provider_id?: string;

  @IsOptional()
  @IsString()
  model_name?: string;
}

export class GuardrailConfigDto {
  @IsOptional()
  @IsString()
  provider_id?: string;

  @IsOptional()
  @IsString()
  model_name?: string;

  @IsOptional()
  @IsString()
  system_prompt?: string;
}

export class AgentDefaultLlmConfigurationDto {
  @IsOptional()
  @IsString()
  provider_id?: string;

  @IsOptional()
  @IsString()
  model_name?: string;

  @IsOptional()
  @IsString()
  tool_call_provider_id?: string;

  @IsOptional()
  @IsString()
  tool_call_model_name?: string;

  @IsOptional()
  @IsObject()
  model_settings?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  tools?: Record<string, { enabled?: boolean; rules?: Record<string, unknown>; guardrail?: boolean; guardrail_system_prompt?: string }>;

  @IsOptional()
  @ValidateNested()
  @Type(() => GuardrailConfigDto)
  guardrail?: GuardrailConfigDto;
}

export class CreateAgentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  system_prompt?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AgentDefaultLlmConfigurationDto)
  default_llm_configuration?: AgentDefaultLlmConfigurationDto | null;

  @IsOptional()
  @IsInt()
  default_model_preset_id?: number | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => AgentModelReferenceDto)
  model_reference?: AgentModelReferenceDto | null;
}

export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  system_prompt?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AgentDefaultLlmConfigurationDto)
  default_llm_configuration?: AgentDefaultLlmConfigurationDto | null;

  @IsOptional()
  @IsInt()
  default_model_preset_id?: number | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => AgentModelReferenceDto)
  model_reference?: AgentModelReferenceDto | null;
}
