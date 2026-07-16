import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response, Request } from 'express';

/**
 * Catch-all exception filter: every error response carries the REAL technical
 * detail — the underlying message and the full cause-chain stack — in the
 * JSON body, not just the log. Runvane is a local-first tool whose user is
 * its developer: sanitized "Internal server error" bodies and bare status
 * codes destroy debuggability and protect nothing.
 *
 * Response shape: `{ statusCode, message, ...HttpException extras, stack }`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    // Walk Error.cause to get the original throw site (wrapping an error in
    // an HttpException must never hide where it actually happened).
    const stack = collectStacks(exception).join('\nCaused by: ');

    const base = isHttp ? normalizeHttpBody(exception.getResponse(), status) : {};
    const message =
      (typeof base.message === 'string' && base.message) ||
      (exception instanceof Error ? exception.message : String(exception));
    const body = { statusCode: status, ...base, message, ...(stack ? { stack } : {}) };

    this.logger.warn({ method: req.method, url: req.url, status, response: body.message, stack }, 'HTTP exception');
    res.status(status).json(body);
  }
}

function normalizeHttpBody(raw: unknown, status: number): Record<string, unknown> & { message?: unknown } {
  if (typeof raw === 'string') return { statusCode: status, message: raw };
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  return { statusCode: status };
}

function collectStacks(err: unknown, depth = 0): string[] {
  if (depth > 5 || !(err instanceof Error)) return [];
  const stack = err.stack ?? `${err.name}: ${err.message}`;
  const causeStacks = err.cause !== undefined ? collectStacks(err.cause, depth + 1) : [];
  return [stack, ...causeStacks];
}
