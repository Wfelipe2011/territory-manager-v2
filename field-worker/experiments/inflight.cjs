// Share only a running operation. Never retain a completed authorization/data read.
function create() {
  const pending = new Map(), stats = { calls: 0, builds: 0, followers: 0 };
  return {
    async run(key, work) {
      stats.calls++;
      let operation = pending.get(key);
      if (operation) stats.followers++;
      else {
        stats.builds++;
        operation = Promise.resolve().then(work);
        pending.set(key, operation);
        operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => {});
      }
      return structuredClone(await operation);
    },
    stats: () => ({ ...stats, pending: pending.size }),
  };
}
module.exports = { create };
