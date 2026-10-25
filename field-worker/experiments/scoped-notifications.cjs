const { Client } = require('pg');
const CHANNEL = 'field_experiment_revision';
function create(url, invalidate) {
  const waiters = new Map(), versions = new Map();
  const stats = { connected: false, connections: 0, notifications: 0, reconnects: 0, failures: 0, notifiedWaits: 0, timerWaits: 0, registrationRaces: 0 };
  let epoch = 0, client, closed = false, reconnect;
  const keyFor = (user, scope) => [user.tenantId, user.territoryId, scope.blockId ?? 0].join(':');
  const version = key => `${epoch}:${versions.get(key) || 0}`;
  const wake = key => { for (const done of [...(waiters.get(key) || [])]) done('notification'); };
  function disconnected() {
    stats.connected = false; epoch++; versions.clear(); invalidate();
    for (const key of [...waiters.keys()]) wake(key);
  }
  async function connect() {
    if (closed) return;
    const next = new Client({ connectionString: url, connectionTimeoutMillis: 3000, application_name: 'field-experiment-scoped-listener' });
    client = next;
    let failed = false;
    const retry = () => {
      if (failed || closed || client !== next) return;
      failed = true; stats.failures++; disconnected(); next.end().catch(() => {});
      reconnect = setTimeout(() => { stats.reconnects++; connect(); }, 1000); reconnect.unref();
    };
    next.on('error', retry); next.on('end', retry);
    next.on('notification', message => {
      if (message.channel !== CHANNEL) return;
      let scope;
      try { scope = JSON.parse(message.payload); } catch { return; }
      if (!Array.isArray(scope) || scope.length !== 3 || !scope.every(Number.isSafeInteger)) return;
      const key = scope.join(':'); stats.notifications++;
      versions.set(key, (versions.get(key) || 0) + 1); invalidate(scope); wake(key);
    });
    try {
      await next.connect(); await next.query('LISTEN ' + CHANNEL);
      if (closed || failed) { await next.end(); return; }
      stats.connected = true; stats.connections++; epoch++; invalidate();
    } catch { retry(); }
  }
  const ready = connect();
  return {
    ready,
    version: (user, scope) => version(keyFor(user, scope)),
    stats: () => ({ ...stats, waiters: [...waiters.values()].reduce((n, set) => n + set.size, 0), dedicatedConnections: stats.connected ? 1 : 0 }),
    wait(user, scope, observed, delay, signal) {
      if (signal.aborted) return Promise.resolve();
      const key = keyFor(user, scope);
      if (observed !== version(key)) { stats.registrationRaces++; return Promise.resolve(); }
      return new Promise(resolve => {
        const group = waiters.get(key) || new Set(); let timer, finished = false;
        const done = reason => {
          if (finished) return; finished = true;
          clearTimeout(timer); signal.removeEventListener('abort', abort); group.delete(done);
          if (!group.size) waiters.delete(key);
          if (reason === 'notification') stats.notifiedWaits++;
          if (reason === 'timer') stats.timerWaits++;
          resolve();
        };
        const abort = () => done('abort');
        group.add(done); waiters.set(key, group); timer = setTimeout(() => done('timer'), delay);
        signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
      });
    },
    close() { closed = true; clearTimeout(reconnect); disconnected(); return client?.end().catch(() => {}); },
  };
}
module.exports = { create, CHANNEL };
