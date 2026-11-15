// IndexedDB: this device's copy, in three stores: lists and items (the protocol's records, each with its server bits
// sb) and sync (the vault's keyring and keys, each server's state, and unreadable rows). Every call degrades to a
// no-op when IndexedDB is unavailable, so the app still works for the session.

export const DB_NAME = "listikka";
export const STORES = [
  ["lists", "id"],
  ["items", "id"],
  ["sync", "k"],
];

export function createIdb(name = DB_NAME, factory = globalThis.indexedDB) {
  return {
    db: null,
    async open() {
      try {
        this.db = await new Promise((res, rej) => {
          const r = factory.open(name, 1);
          r.onupgradeneeded = () => {
            const d = r.result;
            for (const [n, k] of STORES) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: k });
          };
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
          r.onblocked = () => rej(new Error("blocked"));
        });
      } catch (_e) {
        this.db = null;
      }
    },
    all(n) {
      if (!this.db) return Promise.resolve([]);
      return new Promise((res) => {
        try {
          const q = this.db.transaction(n).objectStore(n).getAll();
          q.onsuccess = () => res(q.result || []);
          q.onerror = () => res([]);
        } catch (_e) {
          res([]);
        }
      });
    },
    /** ops: [store, "put"|"delete", value|key], in one transaction. */
    write(ops) {
      if (!this.db || !ops.length) return Promise.resolve();
      return new Promise((res) => {
        try {
          const tx = this.db.transaction([...new Set(ops.map((o) => o[0]))], "readwrite");
          for (const [n, op, v] of ops) tx.objectStore(n)[op](v);
          tx.oncomplete = () => res();
          tx.onerror = tx.onabort = () => res();
        } catch (_e) {
          res();
        }
      });
    },
  };
}

// The same interface in memory: for tests, and as a stand-in.
export function createMemoryDb() {
  const stores = new Map(STORES.map(([n]) => [n, new Map()]));
  const keyOf = (n) => STORES.find(([s]) => s === n)[1];
  return {
    async open() {},
    async all(n) {
      return [...stores.get(n).values()].map((v) => structuredClone(v));
    },
    async write(ops) {
      for (const [n, op, v] of ops) {
        if (op === "put") stores.get(n).set(v[keyOf(n)], structuredClone(v));
        else stores.get(n).delete(v);
      }
    },
  };
}
