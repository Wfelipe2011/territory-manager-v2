import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RequestMetrics, requestCategory } from './request-metrics';

@Injectable()
export class ApiMetrics extends RequestMetrics { constructor() { super('api'); } }

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: ApiMetrics) {}
  use(req: Request, res: Response, next: NextFunction) {
    const category = requestCategory(req.method, req.originalUrl);
    if (!category || !this.metrics.enabled) return next();
    const start = performance.now();
    let recorded = false;
    const record = (aborted: boolean) => {
      if (recorded) return;
      recorded = true;
      this.metrics.record(category, performance.now() - start, res.statusCode, aborted);
    };
    res.once('finish', () => record(false));
    res.once('close', () => record(!res.writableFinished));
    next();
  }
}
