import { SetMetadata } from '@nestjs/common';
import type { ZodType } from 'zod';

export const VALIDATE_RESPONSE_KEY = Symbol('VALIDATE_RESPONSE');

/** Attach a Zod schema to a controller method. The ResponseValidationInterceptor
 *  validates the response body against this schema before it is sent. */
export const ValidateResponse = (schema: ZodType): MethodDecorator =>
  SetMetadata(VALIDATE_RESPONSE_KEY, schema);
