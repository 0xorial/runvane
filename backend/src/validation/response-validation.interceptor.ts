import { Injectable, NestInterceptor, ExecutionContext, CallHandler, InternalServerErrorException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { ZodType } from 'zod';
import { VALIDATE_RESPONSE_KEY } from './validate-response.decorator.js';

@Injectable()
export class ResponseValidationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ResponseValidationInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const schema = this.reflector.get<ZodType | undefined>(VALIDATE_RESPONSE_KEY, context.getHandler());
    if (!schema) return next.handle();

    const req = context.switchToHttp().getRequest<{ method: string; url: string }>();
    const label = `${req.method} ${req.url}`;

    return next.handle().pipe(
      tap((data) => {
        const result = schema.safeParse(data);
        if (!result.success) {
          const details = result.error.issues
            .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
            .join('; ');
          this.logger.error(
            `Response validation failed [${label}]: ${details}\nData: ${JSON.stringify(data)}`,
          );
          throw new InternalServerErrorException(`Response validation failed: ${details}`);
        }
      }),
    );
  }
}
