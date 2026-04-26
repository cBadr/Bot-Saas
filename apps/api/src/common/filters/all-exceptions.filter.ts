import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { OrcaError } from '@orca/shared';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof OrcaError) {
      status = exception.statusCode;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'string') message = resp;
      else if (typeof resp === 'object' && resp) {
        const r = resp as { message?: string | string[]; error?: string };
        message = Array.isArray(r.message) ? r.message.join(', ') : (r.message ?? exception.message);
        code = r.error?.toUpperCase().replace(/\s+/g, '_') ?? `HTTP_${status}`;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(`Unhandled: ${exception.message}`, exception.stack);
    }

    if (status >= 500) {
      this.logger.error(`${req.method} ${req.url} → ${status} ${message}`);
    }

    res.status(status).json({
      ok: false,
      error: { code, message, details },
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }
}
