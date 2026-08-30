import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, { data: T; meta: object; errors: null }> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<{ data: T; meta: object; errors: null }> {
    return next.handle().pipe(map((data) => ({ data, meta: {}, errors: null })));
  }
}
