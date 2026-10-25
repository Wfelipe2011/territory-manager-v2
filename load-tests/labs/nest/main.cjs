require('reflect-metadata');
const { Module, VersioningType } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const cookieParser = require('cookie-parser');
const { assertSynthetic, classes, provenance, cleanupTimer, throttle } = require('../shared/core.cjs');

async function main() {
  assertSynthetic();
  const c = classes();
  class SnapshotLabModule {}
  Module({
    controllers: [c.FieldController],
    providers: [c.PrismaService, c.CatalogRoundService, c.FieldAccessService, c.FieldService, c.TraceService],
  })(SnapshotLabModule);

  const app = await NestFactory.create(SnapshotLabModule, { logger: ['error', 'warn'] });
  const trace = app.get(c.TraceService);
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { limit: '10mb', extended: true });
  const middleware = new c.TraceMiddleware(trace);
  app.use(middleware.use.bind(middleware));
  app.setBaseViewsDir('/app/views');
  app.setViewEngine('hbs');
  app.enableCors();
  app.enableVersioning({ type: VersioningType.URI });
  app.useGlobalFilters(new c.AllExceptionsFilter(trace));
  const { Reflector } = require('@nestjs/core');
  const reflector = app.get(Reflector);
  const limiter = throttle(reflector);
  app.useGlobalGuards(new c.AuthGuard(reflector, app.get(c.FieldAccessService)),
    new c.RolesGuard(reflector), new c.ApiKeyGuard(reflector), limiter.guard);

  // Outside guarded field routes; never returns credentials or database contents.
  app.getHttpAdapter().get('/healthz', (_req, res) => res.json({ ok: true, variant: 'nest-prisma', source: provenance() }));
  const stopCleanup = cleanupTimer(app.get(c.FieldService));
  app.enableShutdownHooks();
  const stop = () => { stopCleanup(); limiter.stop(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  await app.listen(Number(process.env.PORT || 3403), '0.0.0.0');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
