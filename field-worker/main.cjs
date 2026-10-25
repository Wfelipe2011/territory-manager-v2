require('reflect-metadata');
const { Reflector } = require('@nestjs/core');
const { NotFoundException, BadRequestException, Logger } = require('@nestjs/common');
const { Prisma } = require('@prisma/client');
const cookie = require('cookie');
const qs = require('qs');
const fs = require('node:fs');
const hbs = require('hbs');
const path = require('node:path');
const { configure, classes, provenance, cleanupTimer, throttle } = require('./runtime.cjs');
const createAdapter = require('./pg-adapter.cjs');

async function main() {
  const configuration = configure();
  Logger.overrideLogger(['error', 'warn']);
  const c = classes();
  const db = createAdapter(process.env.DATABASE_URL, Prisma.dmmf.datamodel.models);
  await db.$connect();
  if (configuration.readModelEnabled) await db.$readModelReady();
  const rounds = new c.CatalogRoundService(db);
  const access = new c.FieldAccessService(db, rounds);
  const field = new c.FieldService(db, access, rounds);
  {
    const validate=access.validate.bind(access);
    access.validate=user=>db.$withValidation(user,()=>validate(user));
  }
  {
    field.presence = (user,scope) => db.$presenceSummary(user,scope);
    const original = field.snapshot.bind(field);
    field.snapshot = async (tx,user,scope,info) => {
      if (scope.fullBlock) {
        const data = await tx.$blockSnapshot(user,scope,info);
        if (data !== undefined) return data;
        return original(tx.$baselineAdapter(),user,scope,info);
      }
      return original(tx,user,scope,info);
    };
  }
  let readModel, revisionHub;
  if (configuration.readModelEnabled) {
    const aggregate = require('./aggregate-snapshot.cjs');
    readModel = require('./read-model.cjs').install(db, aggregate.snapshot, aggregate.SQL);
    db.$setBlockSnapshot(readModel.read);
    readModel.attach(field);
    revisionHub = require('./revision-listener.cjs').create(process.env.DATABASE_URL, changed => {
      for (const key of field.revisions.keys()) {
        const [tenant,territory,,block] = key.split(':').map(Number);
        if (!changed || (tenant===changed[0] && territory===changed[1] && block===changed[2])) field.revisions.delete(key);
      }
      readModel.refresh(changed);
    });
    require('./revision-poll.cjs').install(field, revisionHub);
    const cleanup = field.cleanup.bind(field);
    field.cleanup = async () => { await cleanup(); await readModel.prune(); };
  }
  const grouping = require('./snapshot-group.cjs').install(field,db);
  const stats = db.$stats;
  db.$stats = () => ({ ...stats(), grouping:grouping(), sharedReads:db.$sharedReadsStats(), readModel:readModel?.stats(), notifications:revisionHub?.stats() });
  const reflector = new Reflector();
  const limiter = throttle(reflector);
  const guards = [new c.AuthGuard(reflector, access), new c.RolesGuard(reflector), new c.ApiKeyGuard(reflector), limiter.guard];
  const trace = new c.TraceService();
  const middleware = new c.TraceMiddleware(trace);
  const filter = new c.AllExceptionsFilter(trace);
  const stopCleanup = cleanupTimer(field);
  const active = new Set();
  const source=provenance();
  const {createHash}=require('node:crypto');
  const implementation=Object.fromEntries(['main.cjs','pg-adapter.cjs','snapshot-queries.cjs','aggregate-snapshot.cjs','validation-query.cjs','runtime.cjs','inflight.cjs','snapshot-group.cjs','revision-poll.cjs','revision-listener.cjs','read-model.cjs'].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(__dirname,file))).digest('hex')]));

  const server = Bun.serve({
    hostname: '0.0.0.0', port: configuration.port,
    idleTimeout: 60, maxRequestBodySize: 10 * 1024 * 1024,
    async fetch(incoming) {
      const url = new URL(incoming.url);
      if (url.pathname === '/healthz') return Response.json({ ok: true, variant: 'bun-pg', mode: 'aggregate', batchValidation: true,
        poolSize: configuration.poolSize, checkIntervalMs: configuration.checkIntervalMs, readModelEnabled:configuration.readModelEnabled,
        listenerConnected:revisionHub?.stats().connected??false, source, implementation,
        ...(process.env.FIELD_WORKER_DIAGNOSTICS === '1' ? { stats: { ...db.$stats(), activeRequests: active.size } } : {}),
      });
      const headers = new Headers({ 'Access-Control-Allow-Origin': '*' });
      if (incoming.method === 'OPTIONS') {
        headers.set('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
        const requested = incoming.headers.get('access-control-request-headers');
        if (requested) headers.set('Access-Control-Allow-Headers', requested);
        headers.set('Vary', 'Access-Control-Request-Headers');
        return new Response(null, { status: 204, headers });
      }
      const match = /^\/v1\/field\/blocks\/([^/]+)\/sync\/?$/.exec(url.pathname);
      const sync = /^\/v1\/field\/sync\/?$/.test(url.pathname);
      const leave = /^\/v1\/field\/session\/?$/.test(url.pathname);
      let status = 200;
      let body;
      let html;
      const req = {
        method: incoming.method, url: url.pathname + url.search, path: url.pathname,
        ip: server.requestIP(incoming)?.address,
        headers: Object.fromEntries(incoming.headers), cookies: cookie.parse(incoming.headers.get('cookie') || ''),
        params: match ? { blockId: decodeURIComponent(match[1]) } : {},
        query: qs.parse(url.search.slice(1)), body: {},
      };
      // The original JSON exception filter and trace middleware run unchanged.
      const res = {
        cookie(name, value, options) {
          headers.append('Set-Cookie', cookie.serialize(name, value, { ...options, maxAge: options.maxAge / 1000, path: '/' }));
        },
        status(value) { status = value; return this; },
        header(name, value) { headers.set(name, String(value)); return this; },
        json(value) { body = value; return this; },
        render(view, data) {
          if (!['401', '403', 'error'].includes(view)) throw Error('Unknown error view');
          html = hbs.handlebars.compile(fs.readFileSync(path.join(__dirname, '../views', view + '.hbs'), 'utf8'))(data);
          return this;
        },
      };
      return new Promise(resolve => middleware.use(req, res, async () => {
        const abort = new AbortController();
        const cancel = () => abort.abort();
        active.add(abort);
        incoming.signal.addEventListener('abort', cancel, { once: true });
        if (incoming.signal.aborted) cancel();
        try {
          if (!((match || sync) && ['GET', 'HEAD'].includes(req.method)) && !(leave && req.method === 'DELETE')) {
            throw new NotFoundException(`Cannot ${req.method} ${url.pathname}`);
          }
          if (incoming.body) {
            const text = await incoming.text();
            try {
              req.body = req.headers['content-type']?.includes('application/json') ? (text ? JSON.parse(text) : {}) :
                req.headers['content-type']?.includes('application/x-www-form-urlencoded') ? qs.parse(text) : {};
            } catch { throw new BadRequestException('Invalid JSON body'); }
          }
          const method = leave ? 'leave' : match ? 'blockSync' : 'sync';
          const context = {
            getClass: () => c.FieldController,
            getHandler: () => c.FieldController.prototype[method],
            switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
          };
          for (const guard of guards) await guard.canActivate(context);
          headers.set('Cache-Control', 'no-store');
          if (leave) {
            await field.leave(req.user, req.query);
            body = { ok: true };
          } else {
            const query = match ? { ...req.query, scope: 'block', blockId: req.params.blockId, addressId: undefined } : req.query;
            body = await field.poll(req.user, query, abort.signal, Boolean(match), req);
          }
        } catch (error) {
          filter.catch(error, { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) });
        } finally {
          incoming.signal.removeEventListener('abort', cancel);
          active.delete(abort);
        }
        headers.set('Content-Type', html === undefined ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8');
        const payload = html === undefined ? (body === undefined ? null : JSON.stringify(body)) : html;
        resolve(new Response(req.method === 'HEAD' ? null : payload, { status, headers }));
      }));
    },
  });
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    stopCleanup();
    readModel?.close();
    limiter.stop();
    for (const abort of active) abort.abort();
    await server.stop();
    await revisionHub?.close();
    await db.$disconnect();
  }
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
