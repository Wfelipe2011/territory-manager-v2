const { AsyncLocalStorage } = require('node:async_hooks');
function install(db, aggregate, original, SQL) {
  const contexts = new AsyncLocalStorage(), transaction = db.$transaction.bind(db);
  const stats = { hits: 0, misses: 0, stored: 0, storeFailures: 0, background: 0, backgroundFailures: 0 };
  const watched = new Map(), pending = new Map();
  let field, closed = false;
  db.$transaction = async (work, options) => {
    if (typeof work !== 'function') return transaction(work, options);
    const writes = [];
    const value = await contexts.run(writes, () => transaction(work, options));
    // Store AFTER the snapshot transaction commits. Never mix a new cursor with
    // an old payload; concurrent builders can safely insert the same version.
    for (const row of writes) {
      try {
        await db.$queryRaw`SELECT field_experiment_store(${row[0]}::integer,${row[1]}::integer,${row[2]}::integer,${row[3]}::integer,${row[4]}::text,${row[5]}::jsonb)`;
        stats.stored++;
      } catch { stats.storeFailures++; } // A failed optimization must not lose the successful source read.
    }
    return value;
  };
  aggregate.snapshot = async (connection, user, scope, info) => {
    const revisions = await connection.query('SELECT round_number,revision::text FROM field_revision WHERE tenant_id=$1 AND territory_id=$2 AND block_id=$3 AND round_number IN (0,$4)', [user.tenantId, user.territoryId, scope.blockId, scope.round ?? 0]);
    const version = JSON.stringify([revisions.rows.find(r => r.round_number === 0)?.revision ?? '0', revisions.rows.find(r => r.round_number === (scope.round ?? 0))?.revision ?? '0', info?.status ?? null, info?.closedAt ?? null]);
    const key = [user.tenantId, user.territoryId, scope.blockId, scope.round ?? -1, version];
    const watchedKey = JSON.stringify(key.slice(0, 4));
    watched.set(watchedKey, { user: structuredClone(user), scope: structuredClone(scope) });
    const cached = await connection.query('SELECT payload FROM field_experiment_read_model WHERE tenant_id=$1 AND territory_id=$2 AND block_id=$3 AND round_number=$4 AND revision=$5', key);
    let payload = cached.rows[0]?.payload;
    if (payload) stats.hits++;
    else {
      stats.misses++;
      payload = (await connection.query(SQL, [user.tenantId, user.territoryId, scope.blockId, scope.round ?? -1, info?.status === 'closed'])).rows[0].payload;
      const saved = structuredClone(payload);
      if (saved.block) saved.block._signature = null;
      contexts.getStore()?.push([...key, JSON.stringify(saved)]);
    }
    payload = structuredClone(payload);
    if (payload.block) {
      // Never persist signature tokens/grants, even when catalog revision is unchanged.
      const signature = await connection.query(`SELECT s.key,s.expiration_date AS "expirationDate",s.token FROM territory_block l JOIN signature s ON s.id=l.signature_id WHERE l.tenant_id=$1 AND l.territory_id=$2 AND l.block_id=$3 AND l.registration_status<>'rejected' LIMIT 1`, key.slice(0, 3));
      payload.block._signature = signature.rows[0] ?? null;
    }
    // Original sorting, temporal permissions, profile and signature expiry are
    // recomputed on every response, NOT stored as final authorized JSON.
    return original({ query: async () => ({ rows: [{ payload }] }) }, user, scope, info);
  };
  function refresh(changed) {
    if (!field || closed) return;
    for (const [key, request] of watched) {
      const { user, scope } = request;
      if (changed && (user.tenantId !== changed[0] || user.territoryId !== changed[1] || scope.blockId !== changed[2])) continue;
      if (pending.has(key)) { pending.get(key).dirty = true; continue; }
      const state = { dirty: true };
      pending.set(key, state);
      (async () => {
        while (state.dirty && !closed) {
          state.dirty = false;
          stats.background++;
          await db.$transaction(async tx => {
            const info = await field.rounds.resolve(user.tenantId, user.territoryId, user.round, tx);
            return tx.$blockSnapshot(user, { ...scope, round: info?.roundNumber ?? null }, info);
          }, { isolationLevel: 'RepeatableRead' });
        }
      })().catch(() => { stats.backgroundFailures++; }).finally(() => pending.delete(key));
    }
  }
  return { attach(value) { field = value; }, refresh, close() { closed = true; }, stats: () => ({ ...stats, watched: watched.size, pending: pending.size }) };
}
module.exports = { install };
