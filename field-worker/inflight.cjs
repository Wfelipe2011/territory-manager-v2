// Share live work only. Completed reads and authorization decisions are not cached.
function create() {
  const pending = new Map(), counts = { calls: 0, builds: 0, followers: 0 };
  return {
    async run(key, work) {
      counts.calls++;
      let value = pending.get(key);
      if (value) counts.followers++;
      else {
        counts.builds++; value = Promise.resolve().then(work); pending.set(key, value);
        value.finally(() => { if (pending.get(key) === value) pending.delete(key); }).catch(() => {});
      }
      return structuredClone(await value);
    },
    stats: () => ({ ...counts, pending: pending.size }),
  };
}
module.exports = { create };
