import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { CacheInterceptor } from '@nestjs/cache-manager';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { Cache } from 'cache-manager';
import { SKIP_CACHE } from '../decorators/skip-cache.decorator';

@Injectable()
export class SkipCacheInterceptor extends CacheInterceptor {
  constructor(cacheManager: Cache, reflector: Reflector) {
    super(cacheManager, reflector);
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CACHE, [context.getHandler(), context.getClass()]);
    if (skip) {
      return next.handle();
    }
    return super.intercept(context, next);
  }
}
