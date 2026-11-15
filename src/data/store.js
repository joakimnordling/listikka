/* Local-first: every list and item lives in memory and in IndexedDB on this device, and syncs through the servers set
   up in Settings. Records are kept in the protocol's shape (src/core/records.js) with their server bits `sb`: bit n set
   means server n has this version. A change made here clears every bit, so every server gets it. */

import { sameRecord } from "../../vendor/lokki-sync/crypto.js";
import { merge } from "../core/merge.js";

const STORE_OF = { list: "lists", item: "items" };
const strip = ({ sb: _, ...record }) => record;

export function createStore(db) {
  const maps = { list: new Map(), item: new Map() }; // id -> {record, sb}
  const listeners = new Set();
  return {
    db,
    maps,
    async load() {
      await db.open();
      for (const kind of ["list", "item"]) {
        maps[kind].clear();
        for (const row of await db.all(STORE_OF[kind])) maps[kind].set(row.id, { record: strip(row), sb: row.sb || 0 });
      }
    },
    get(kind, id) {
      return maps[kind]?.get(id)?.record ?? null;
    },
    lists() {
      return [...maps.list.values()].map((e) => e.record);
    },
    items() {
      return [...maps.item.values()].map((e) => e.record);
    },
    /** Run fn after any change, local or pulled (for the UI). */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    changed() {
      for (const fn of listeners) fn();
    },
    /**
     * Changes made on this device: each is merged with the version kept here, and the result saved with no server
     * bits. Returns the records that changed.
     */
    async change(versions) {
      const ops = [];
      const out = [];
      for (const v of versions.filter(Boolean)) {
        const cur = maps[v.kind].get(v.id);
        const next = cur ? merge(cur.record, v) : v;
        if (cur && sameRecord(next, cur.record)) continue;
        maps[v.kind].set(v.id, { record: next, sb: 0 });
        ops.push([STORE_OF[v.kind], "put", { ...next, sb: 0 }]);
        out.push(next);
      }
      await db.write(ops);
      if (out.length) this.changed();
      return out;
    },
    /** Records as they came from a sync: stored with exactly these bits. */
    async put(records, sb) {
      const ops = [];
      for (const r of records) {
        maps[r.kind].set(r.id, { record: r, sb });
        ops.push([STORE_OF[r.kind], "put", { ...r, sb }]);
      }
      await db.write(ops);
    },
    bits(kind, id) {
      return maps[kind]?.get(id)?.sb ?? 0;
    },
    /** Set a record's bits in memory; returns the write to save it, or null when nothing changed. */
    setBits(kind, id, sb) {
      const e = maps[kind]?.get(id);
      if (!e || e.sb === sb) return null;
      e.sb = sb;
      return [STORE_OF[kind], "put", { ...e.record, sb }];
    },
    *entries() {
      for (const kind of ["list", "item"]) for (const e of maps[kind].values()) yield e;
    },
  };
}
