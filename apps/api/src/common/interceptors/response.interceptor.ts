import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, { ok: true; data: T }> {
  intercept(_ctx: ExecutionContext, next: CallHandler<T>): Observable<{ ok: true; data: T }> {
    return next.handle().pipe(map((data) => ({ ok: true, data })));
  }
}
