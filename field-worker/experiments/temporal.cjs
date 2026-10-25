function deadline(snapshot) {
  const times = [];
  if (snapshot.data?.block?.signature?.expirationDate) times.push(new Date(snapshot.data.block.signature.expirationDate).getTime());
  for (const street of snapshot.data?.streets || []) for (const house of street.houses) {
    if (house.canUnmarkUntil && !house.blockedReason) times.push(new Date(house.canUnmarkUntil).getTime());
  }
  return times.length ? Math.min(...times) : Infinity;
}
function finalize(snapshot, now = Date.now()) {
  const block = snapshot.data?.block;
  if (block?.signature && new Date(block.signature.expirationDate).getTime() <= now) block.signature = null;
  for (const street of snapshot.data?.streets || []) for (const house of street.houses) {
    if (!house.blockedReason && house.canUnmarkUntil && new Date(house.canUnmarkUntil).getTime() <= now) {
      house.canMark = false; house.canUnmark = false; house.blockedReason = 'unmark_window_expired';
    }
  }
  return snapshot;
}
module.exports = { deadline, finalize };
