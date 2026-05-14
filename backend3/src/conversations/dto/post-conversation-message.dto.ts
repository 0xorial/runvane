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

  /**
   * Where the user wants this message attached. Required for non-empty
   * conversations; pass `null`/omit only on the very first message.
   * Branching is driven exclusively by this field — the server does not
   * derive parents from any persisted "default view" hint.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  parentId?: string;

  /**
   * Opaque client-generated correlation token. The server echoes it on the
   * resulting USER_MESSAGE SSE event so the originating client can swap its
   * optimistic UI row for the canonical entry without text-matching.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  clientRequestId?: string;
}
