/* Listikka's sync: the shared manager (vendor/lokki-sync/manager.js) with Listikka's settings, its device and
   IndexedDB's "sync" store. */
import { createSyncManager } from "../../vendor/lokki-sync/manager.js";
import { LISTIKKA } from "./app.js";
import { ListikkaDevice } from "./device.js";

export { hostOf } from "../../vendor/lokki-sync/manager.js";

export const OTHER_APP = "This server's vault is for another app, not Listikka. Use another token or server.";

export const createSync = (store, { onSynced = () => store.changed() } = {}) =>
  createSyncManager({
    app: LISTIKKA,
    store: {
      all: () => store.db.all("sync"),
      write: (ops) => store.db.write(ops.map(([op, value]) => ["sync", op, value])),
    },
    makeDevice: (vault, unreadable) => new ListikkaDevice(store, vault, unreadable),
    words: { otherApp: OTHER_APP },
    onSynced,
  });
