const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');

// Always compile from this checkout. No dependency on load-test images/artifacts.
const dist = path.resolve(__dirname, '../dist');
const load = name => require(path.join(dist, name));

function configure(env = process.env) {
  if (!env.DATABASE_URL || !env.JWT_SECRET || !env.API_KEY_SECRET) {
    throw Error('DATABASE_URL, JWT_SECRET and API_KEY_SECRET are required');
  }
  const url = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.pathname.slice(1)) {
    throw Error('A PostgreSQL database URL is required');
  }
  if (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public') {
    throw Error('Field worker supports only the public schema');
  }
  const integer = (value, min, max, name) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw Error('Invalid ' + name);
    return parsed;
  };
  const poolSize = integer(env.FIELD_DB_POOL_SIZE || '2', 1, 64, 'FIELD_DB_POOL_SIZE');
  const checkIntervalMs = integer(env.FIELD_POLL_CHECK_MS || '1000', 100, 25000, 'FIELD_POLL_CHECK_MS');
  const port = integer(env.PORT || '3402', 1, 65535, 'PORT');
  url.searchParams.set('connection_limit', String(poolSize));
  env.DATABASE_URL = url.toString();
  env.FIELD_POLL_CHECK_MS = String(checkIntervalMs);
  if (env.FIELD_READ_MODEL_ENABLED && !['0','1'].includes(env.FIELD_READ_MODEL_ENABLED)) throw Error('Invalid FIELD_READ_MODEL_ENABLED');
  return { poolSize, checkIntervalMs, port, readModelEnabled: env.FIELD_READ_MODEL_ENABLED !== '0' };
}

function classes() {
  return {
    FieldService: load('modules/field/field.service.js').FieldService,
    FieldAccessService: load('modules/field/field-access.service.js').FieldAccessService,
    CatalogRoundService: load('modules/round/catalog-round.service.js').CatalogRoundService,
    FieldController: load('modules/field/field.controller.js').FieldController,
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

module.exports = { configure, classes, provenance, cleanupTimer, throttle };
