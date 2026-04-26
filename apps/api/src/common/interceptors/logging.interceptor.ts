import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { createLogger } from '@orca/logger';
import { nanoid } from 'nanoid';
import type { Request, Response } from 'express';

const log = createLogger('API', { module: 'HTTP' });

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request & { requestId?: string; user?: { sub?: string } }>();
    const res = http.getResponse<Response>();
    req.requestId ??= nanoid(10);
    res.setHeader('X-Request-Id', req.requestId);
    const start = Date.now();
    return next.handle().pipe(
      tap({
        next: () => {
          log.info('request', {
            requestId: req.requestId,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            durationMs: Date.now() - start,
            userId: req.user?.sub,
          });
        },
        error: (err) => {
          log.warn('request error', {
            requestId: req.requestId,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode || 500,
            durationMs: Date.now() - start,
            err: err instanceof Error ? err.message : String(err),
          });
        },
      }),
    );
  }
}
