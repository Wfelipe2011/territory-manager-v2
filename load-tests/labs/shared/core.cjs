const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');

const dist = process.env.LAB_DIST || '/app/dist';
const load = name => require(path.join(dist, name));

function assertSynthetic() {
  const url = new URL(process.env.DATABASE_URL);
  if (url.hostname !== 'db' || url.pathname !== '/territory_manager_peak_load' ||
      url.username !== 'load' || process.env.JWT_SECRET !== 'load-test-isolated-secret') {
    throw new Error('Laboratories accept ONLY the isolated synthetic database');
  }
}

function classes() {
  return {
    FieldService: load('modules/field/field.service.js').FieldService,
    FieldAccessService: load('modules/field/field-access.service.js').FieldAccessService,
    CatalogRoundService: load('modules/round/catalog-round.service.js').CatalogRoundService,
    FieldController: load('modules/field/field.controller.js').FieldController,
    PrismaService: load('infra/prisma/prisma.service.js').PrismaService,
    AuthGuard: load('modules/auth/guard/auth.guard.js').AuthGuard,
    RolesGuard: load('modules/auth/guard/roles.guard.js').RolesGuard,
    ApiKeyGuard: load('decorators/api-key.guard.js').ApiKeyGuard,
    TraceService: load('infra/trace/trace.service.js').TraceService,
    TraceMiddleware: load('infra/trace/trace.middleware.js').TraceMiddleware,
    AllExceptionsFilter: load('middleware/all-exceptions.filter.js').AllExceptionsFilter,
  };
}

function provenance() {
  const files = [
    'modules/field/field.service.js', 'modules/field/field-access.service.js',
    'modules/field/field.controller.js', 'modules/round/catalog-round.service.js',
    'modules/house/house-permissions.js', 'modules/field/pair-suggestion.js',
    'modules/auth/guard/auth.guard.js', 'modules/auth/guard/roles.guard.js',
    'middleware/all-exceptions.filter.js',
  ];
  return Object.fromEntries(files.map(file => [file,
    createHash('sha256').update(fs.readFileSync(path.join(dist, file))).digest('hex')]));
}

function cleanupTimer(field) {
  // The original application schedules THIS task every 30 seconds. No unrelated cron jobs.
  const timer = setInterval(() => field.cleanup().catch(error => console.error('Field cleanup failed:', error.message)), 30000);
  timer.unref();
  return () => clearInterval(timer);
}

function throttle(reflector) {
  const { ThrottlerGuard, ThrottlerStorageService } = require('@nestjs/throttler');
  const storage = new ThrottlerStorageService();
  return {
    guard: new ThrottlerGuard({ ttl: 5, limit: 10000 }, storage, reflector),
    stop: () => storage.onApplicationShutdown(),
  };
}

module.exports = { assertSynthetic, classes, provenance, cleanupTimer, throttle };
