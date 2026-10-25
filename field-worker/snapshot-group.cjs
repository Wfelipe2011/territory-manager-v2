const { AsyncLocalStorage } = require('node:async_hooks');
function deadline(value) {
  let result = Infinity;
  const signature = value.data?.block?.signature;
  if (signature) result = new Date(signature.expirationDate).getTime();
  for (const street of value.data?.streets || []) for (const house of street.houses) {
    if (house.canUnmarkUntil && !house.blockedReason) result = Math.min(result, new Date(house.canUnmarkUntil).getTime());
  }
  return result;
}
function finalize(value, now = Date.now()) {
  const block = value.data?.block;
  if (block?.signature && new Date(block.signature.expirationDate).getTime() <= now) block.signature = null;
  for (const street of value.data?.streets || []) for (const house of street.houses) {
    if (!house.blockedReason && house.canUnmarkUntil && new Date(house.canUnmarkUntil).getTime() <= now) {
      house.canMark = false; house.canUnmark = false; house.blockedReason = 'unmark_window_expired';
    }
  }
  return value;
}
function install(field, db) {
  const contexts = new AsyncLocalStorage(), pending = new Map();
  const counts = { eligible: 0, builds: 0, followers: 0, mismatchedRevision: 0, bypass: 0 };
  const poll = field.poll.bind(field), scope = field.scope.bind(field), current = field.currentRevision.bind(field), transaction = db.$transaction.bind(db);
  field.poll = (user, ...args) => contexts.run({ user }, () => poll(user, ...args));
  field.scope = async (...args) => { const value = await scope(...args), context = contexts.getStore(); if (context) context.scope = value; return value; };
  field.currentRevision = (...args) => {
    const value = current(...args), context = contexts.getStore();
    if (context) value.entry.value.then(revision => { context.revision = revision; }, () => {});
    return value;
  };
  db.$transaction = async (work, options = {}) => {
    const context = contexts.getStore();
    if (typeof work !== 'function' || options.isolationLevel !== 'RepeatableRead' || !context?.scope?.fullBlock || !context.revision) {
      counts.bypass++; return transaction(work, options);
    }
    const { user, scope: s } = context;
    const key = JSON.stringify([user.tenantId,user.territoryId,s.blockId,s.round,context.revision,user.round??null,[...user.roles].sort(),s.hours,s.canEditStructure,s.scope,s.addressId??null,s.fullBlock]);
    counts.eligible++;
    let operation = pending.get(key);
    if (operation) counts.followers++;
    else {
      counts.builds++;
      operation = transaction(async tx => {
        const value = await work(tx);
        if (value.cursor !== context.revision) counts.mismatchedRevision++;
        return { value, round: s.round, hours: s.hours, deadline: deadline(value) };
      }, options);
      pending.set(key, operation);
      operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => {});
    }
    const result = await operation;
    s.round = result.round; s.hours = result.hours;
    const value = structuredClone(result.value);
    return result.deadline <= Date.now() ? finalize(value) : value;
  };
  return () => ({ ...counts, pending: pending.size });
}
module.exports = { install, deadline, finalize };
