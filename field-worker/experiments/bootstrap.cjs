// Lab-only entry point: ordinary Compose continues starting ../main.cjs.
if (process.env.FIELD_EXPERIMENT !== 'grouped' && process.env.FIELD_EXPERIMENT !== 'notify') throw Error('Explicit experiment variant required');
const runtime = require('../runtime.cjs');
const classes = runtime.classes, cleanup = runtime.cleanupTimer;
const { createHash } = require('node:crypto');
const fs = require('node:fs'), path = require('node:path');
const variant = process.env.FIELD_EXPERIMENT;
const hashes = Object.fromEntries(['bootstrap.cjs', 'grouping.cjs', 'notifications.cjs', 'event-poll.cjs'].map(file =>
  [file, createHash('sha256').update(fs.readFileSync(path.join(__dirname, file))).digest('hex')]));
runtime.classes = () => {
  const original = classes();
  return { ...original, FieldService: class extends original.FieldService {
    constructor(db, access, rounds) {
      super(db, access, rounds);
      if (variant === 'notify') {
        this.experimentHub = require('./notifications.cjs').create(process.env.DATABASE_URL, scope => {
          for (const key of this.revisions.keys()) {
            const [tenant, territory, , block] = key.split(':').map(Number);
            if (!scope || (tenant === scope[0] && territory === scope[1] && block === scope[2])) this.revisions.delete(key);
          }
        });
        require('./event-poll.cjs').install(this, this.experimentHub);
      }
      const grouped = require('./grouping.cjs').install(this, db), stats = db.$stats;
      db.$stats = () => ({ ...stats(), experiment: { variant, hashes, grouping: grouped(), notifications: this.experimentHub?.stats() } });
    }
  } };
};
runtime.cleanupTimer = field => {
  const stop = cleanup(field);
  return () => { stop(); field.experimentHub?.close(); };
};
require('../main.cjs');
