// Timestamps come from the device's clock, kept monotonic: never lower than the highest
// timestamp the device has already seen, plus one. Sync calls observe() for every record it pulls.
export function createClock(now = Date.now) {
  let last = 0;
  return {
    now() {
      last = Math.max(now(), last + 1);
      return last;
    },
    observe(t) {
      if (Number.isFinite(t) && t > last) last = t;
    },
    observeRecord(rec) {
      for (const t of Object.values(rec?.ts || {})) this.observe(t);
    },
    get last() {
      return last;
    },
  };
}
