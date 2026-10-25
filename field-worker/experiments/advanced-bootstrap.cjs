// Experiment image only. Ordinary local Compose never uses this entry point.
const variant = process.env.FIELD_EXPERIMENT;
if (!['reference', 'expanded', 'sql', 'readmodel'].includes(variant)) throw Error('Explicit advanced experiment required');
const target = new URL(process.env.DATABASE_URL);
if (target.hostname !== 'db' || target.username !== 'load' || target.pathname !== '/territory_manager_peak_load') throw Error('Advanced experiments require the isolated synthetic database');
const runtime = require('../runtime.cjs'), factory = require('../pg-adapter.cjs');
const { create } = require('./inflight.cjs');
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const hashes = Object.fromEntries(fs.readdirSync(__dirname).filter(f => f.endsWith('.cjs') || f.endsWith('.sql')).map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(__dirname, f))).digest('hex')]));
if (variant !== 'reference') require.cache[require.resolve('../validation-query.cjs')] = { exports: require('./expanded-validation.cjs') };
const timing = { acquisitions: 0, poolWaitMs: 0, poolWaitMaxMs: 0, lagSamples: 0, lagTotalMs: 0, lagMaxMs: 0 };
const Pool = require('pg').Pool, connect = Pool.prototype.connect;
Pool.prototype.connect = function (...args) {
  const start = performance.now(), record = () => { const ms = performance.now() - start; timing.acquisitions++; timing.poolWaitMs += ms; timing.poolWaitMaxMs = Math.max(timing.poolWaitMaxMs, ms); };
  if (typeof args[0] === 'function') {
    const callback = args[0]; return connect.call(this, (...result) => { record(); callback(...result); });
  }
  return connect.apply(this, args).finally(record);
};
let last = performance.now();
const lag = setInterval(() => { const now = performance.now(), ms = Math.max(0, now - last - 100); last = now; timing.lagSamples++; timing.lagTotalMs += ms; timing.lagMaxMs = Math.max(timing.lagMaxMs, ms); }, 100);
lag.unref();
let readModel;
require.cache[require.resolve('../pg-adapter.cjs')].exports = (...args) => {
  const db = factory(...args);
  const reads = create();
  if (variant !== 'reference') {
    for (const name of ['parameter', 'round_info', 'territory_block', 'territory', 'multitenancy']) {
      for (const [method, original] of Object.entries(db[name] || {})) db[name][method] = input => reads.run(JSON.stringify([name, method, input]), () => original(input));
    }
    const presence = db.$presenceSummary.bind(db);
    db.$presenceSummary = (user, scope) => reads.run(JSON.stringify(['presence', user.tenantId, user.id, user.territoryId, user.blockId, user.roles, scope]), () => presence(user, scope));
  }
  if (variant === 'sql' || variant === 'readmodel') {
    const aggregate = require('../aggregate-snapshot.cjs'), original = aggregate.snapshot;
    const { SQL, originalSQL } = require('./sql-snapshot.cjs');
    if (variant === 'readmodel') readModel = require('./read-model.cjs').install(db, aggregate, original, SQL);
    else aggregate.snapshot = (connection, ...rest) => original({ query: (text, values) => connection.query(text === originalSQL ? SQL : text, values) }, ...rest);
  }
  db.$advancedReads = reads.stats;
  return db;
};
const classes = runtime.classes, cleanup = runtime.cleanupTimer;
runtime.classes = () => {
  const original = classes();
  return { ...original, FieldService: class extends original.FieldService {
    constructor(db, access, rounds) {
      super(db, access, rounds);
      if (variant !== 'reference') {
        this.experimentDeadline = require('./temporal.cjs').deadline;
        this.experimentFinalize = require('./temporal.cjs').finalize;
      }
      if (variant === 'readmodel') {
        readModel.attach(this);
        this.experimentHub = require('./scoped-notifications.cjs').create(process.env.DATABASE_URL, changed => {
          for (const key of this.revisions.keys()) {
            const [tenant, territory, , block] = key.split(':').map(Number);
            if (!changed || (tenant === changed[0] && territory === changed[1] && block === changed[2])) this.revisions.delete(key);
          }
          readModel.refresh(changed);
        });
        require('./event-poll.cjs').install(this, this.experimentHub);
      }
      const grouped = variant === 'reference' ? () => ({ eligible: 0 }) : require('./grouping.cjs').install(this, db);
      const stats = db.$stats;
      db.$stats = () => ({ ...stats(), experiment: { variant, hashes, timing: { ...timing }, grouping: grouped(), reads: db.$advancedReads(), readModel: readModel?.stats(), notifications: this.experimentHub?.stats() } });
    }
  } };
};
runtime.cleanupTimer = field => {
  const stop = cleanup(field);
  return () => { clearInterval(lag); readModel?.close(); stop(); field.experimentHub?.close(); };
};
require('../main.cjs');
