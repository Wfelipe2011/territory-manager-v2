const { AsyncLocalStorage } = require('node:async_hooks');

// In-flight only: no TTL cache, no authorization sharing. Share the ENTIRE
// RepeatableRead result, never a payload from one transaction with another cursor.
function install(field, db) {
  const storage = new AsyncLocalStorage(), pending = new Map();
  const stats = { eligible: 0, builds: 0, followers: 0, mismatchedRevision: 0, bypass: 0 };
  const poll = field.poll.bind(field), scope = field.scope.bind(field);
  const current = field.currentRevision.bind(field), transaction = db.$transaction.bind(db);
  field.poll = (user, ...args) => storage.run({ user }, () => poll(user, ...args));
  field.scope = async (...args) => {
    const value = await scope(...args), context = storage.getStore();
    if (context) context.scope = value;
    return value;
  };
  field.currentRevision = (...args) => {
    const value = current(...args), context = storage.getStore();
    // Register before poll's await continuation, preserving the original entry
    // object identity used by FieldService to invalidate an obsolete revision.
    if (context) value.entry.value.then(revision => { context.revision = revision; }, () => {});
    return value;
  };
  db.$transaction = async (work, options = {}) => {
    const context = storage.getStore();
    if (typeof work !== 'function' || options.isolationLevel !== 'RepeatableRead' ||
        !context?.scope?.fullBlock || !context.revision) {
      stats.bypass++; return transaction(work, options);
    }
    const { user, scope: s } = context;
    const key = JSON.stringify([user.tenantId, user.territoryId, s.blockId, s.round,
      context.revision, user.round ?? null, [...user.roles].sort(), s.hours,
      s.canEditStructure, s.scope, s.addressId ?? null, s.fullBlock]);
    stats.eligible++;
    let operation = pending.get(key);
    if (operation) stats.followers++;
    else {
      stats.builds++;
      operation = transaction(async tx => {
        const value = await work(tx);
        // Do not reuse this result outside the live operation. The transaction
        // itself may have observed a newer revision or newly selected round.
        if (value.cursor !== context.revision) stats.mismatchedRevision++;
        return { value, round: s.round, hours: s.hours, deadline: field.experimentDeadline?.(value) };
      }, options);
      pending.set(key, operation);
      operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => {});
    }
    const result = await operation;
    s.round = result.round; s.hours = result.hours;
    const value = structuredClone(result.value);
    return result.deadline <= Date.now() && field.experimentFinalize ? field.experimentFinalize(value) : value;
  };
  return () => ({ ...stats, pending: pending.size });
}
module.exports = { install };
