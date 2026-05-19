import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response, Request } from 'express';

@Catch(HttpException)
export class HttpExceptionLoggingFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionLoggingFilter.name);

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const status = exception.getStatus?.() ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception.getResponse();

    // Walk Error.cause to get the original throw site (NestJS often wraps a
    // domain error in HttpException, hiding the actual stack).
    const stacks = collectStacks(exception);

    this.logger.warn(
      {
        method: req.method,
        url: req.url,
        status,
        response: body,
        stack: stacks.join('\nCaused by: '),
      },
      'HTTP exception',
    );

    res.status(status).json(body);
  }
}

function collectStacks(err: unknown, depth = 0): string[] {
  if (depth > 5 || !(err instanceof Error)) return [];
  const stack = err.stack ?? `${err.name}: ${err.message}`;
  const causeStacks = err.cause !== undefined ? collectStacks(err.cause, depth + 1) : [];
  return [stack, ...causeStacks];
}
