/* Clearing this device's data, as in Lokki:
   - clearEverything: the lists and items, the sync setup and this device's settings. What's on the servers stays.
   - clearCopy: only the lists and items; they download again from the servers and groups, and the settings and the
     sync setup stay. Changes that haven't reached a server yet are lost, so the UI warns first.
   Both reload the app. */

const reload = () => location.reload();

export async function clearEverything(db) {
  await db.destroy();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("listikka-")) localStorage.removeItem(k);
  } catch {
    /* not kept in this browser */
  }
  reload();
}

/**
 * servers: the sync's servers, and groups: the sharing groups (src/groups/manager.js), whose state is reset so the
 * next sync downloads everything.
 */
export async function clearCopy(db, servers = [], groups = []) {
  await db.clear(["lists", "items"]);
  // rows a server holds in a format this device can't read are found again by the full download
  const unreadable = (await db.all("sync")).filter((r) => r.k.startsWith("unreadable:"));
  await db.write([
    ...unreadable.map((r) => ["sync", "delete", r.k]),
    ...servers.map((s) => ["sync", "put", { ...s, cursor: 0, mark: null, keyringVersion: 0, last: null }]),
    ...groups.map((g) => ["sync", "put", { ...g, heads: {}, last: null }]),
  ]);
  reload();
}
