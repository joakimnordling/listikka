/* The app's data and what the screen is doing. Lists and items live in the store (src/data/store.js) and sync through
   the servers set up in Settings; every change goes through the core's list actions (src/core/lists.js), so it gets its
   timestamps and merges with other devices' changes. Which lists are open, which hide ticked items, drafts and the
   theme are this device's own, kept in localStorage. */

import { createClock } from "../core/clock.js";
import * as L from "../core/lists.js";
import { EDITABLE, edit, isLive } from "../core/records.js";
import { createIdb } from "../data/idb.js";
import { createStore } from "../data/store.js";
import { createGroups } from "../groups/manager.js";
import { LISTIKKA } from "../sync/app.js";
import { ListikkaDevice } from "../sync/device.js";
import { createSync } from "../sync/manager.js";

/* ---------- Data ---------- */
export const clock = createClock();
export const store = createStore(createIdb());
export const sync = createSync(store);
// Sharing groups, next to the servers (src/groups/manager.js)
export const groups = createGroups({
  app: LISTIKKA,
  store: {
    all: () => store.db.all("sync"),
    write: (ops) => store.db.write(ops.map(([op, value]) => ["sync", op, value])),
  },
  makeDevice: () => new ListikkaDevice(store, { keyring: null, save() {} }),
});
// For the end-to-end tests (tests/e2e), as Lokki's window.__lokki
window.__listikka = { store, sync, groups };

/**
 * How syncing stands, sync servers and groups together:
 *   any       set up with at least one server or group; paused: all of them are paused here
 *   failing   a server or group that isn't paused has a problem
 *   waiting   changes no server or group that isn't paused has yet
 *   onlyHere  changes no server or group has at all, paused ones too: clearing this device's data would lose them
 */
export function syncState() {
  const servers = sync.vault ? sync.servers : [];
  const all = [...servers.map((s) => s.bit), ...groups.bits()];
  const active = [...servers.filter((s) => !s.paused).map((s) => s.bit), ...groups.bits(true)];
  const device = sync.device;
  const count = (bits) => (bits.length && device ? device.lacking(bits).nowhere : 0);
  return {
    any: all.length > 0,
    paused: all.length > 0 && !active.length,
    failing: sync.status().failing || groups.status().failing,
    waiting: count(active),
    onlyHere: count(all),
  };
}

export const byId = () => L.indexLists(store.lists());
export const activeLists = () => L.activeLists(store.lists());
export const removedLists = () => L.removedLists(store.lists());
export const liveItems = () => store.items().filter(isLive);
export const listOf = (i) => L.listKeyOf(i, byId());
export const itemsIn = (key) => L.itemsIn(store.items(), key, byId());
export const getItem = (id) => store.get("item", id);
export const getList = (id) => store.get("list", id);
export const listName = (key) => (key ? (getList(key)?.name ?? "") : "No list");

/** Save changes made here; the store merges them, tells the screen, and the servers and groups get them soon. */
export async function save(versions) {
  const changed = await store.change(versions.filter(Boolean));
  if (changed.length) {
    sync.soon();
    groups.soon();
  }
  return changed;
}

/** What undo needs: the records as they are now, to write their editable fields back with new timestamps. */
export const snapshot = (records) => records.filter(Boolean).map((r) => structuredClone(r));
export function undo(snap) {
  const back = [];
  for (const old of snap) {
    const cur = store.get(old.kind, old.id);
    if (!cur || !isLive(cur)) continue;
    back.push(edit(cur, Object.fromEntries(EDITABLE[old.kind].map((f) => [f, old[f]])), clock));
  }
  return save(back);
}

/* ---------- This device's settings ---------- */
const PREFS = "listikka-ui";
export const ui = { open: {}, hide: {}, drafts: {}, theme: "indigo", themeChosen: false };
try {
  Object.assign(ui, JSON.parse(localStorage.getItem(PREFS) || "{}"));
} catch {
  /* not kept in this browser */
}
if (!ui.themeChosen) ui.theme = "indigo";
export function savePrefs() {
  try {
    localStorage.setItem(PREFS, JSON.stringify(ui));
  } catch {
    /* not kept in this browser */
  }
}
export const isOpen = (key) => ui.open[key] !== false;
export const inRemoved = (key) => S.removedAll || S.removedMode === key;
export const allKeys = () => ["", ...activeLists().map((l) => l.id)];

/* ---------- Transient state ---------- */
// What the screen is doing now, shared by the ui modules. Not kept: it starts over on each load.
export const S = {
  loaded: false,
  view: "main",
  adding: null, // list key whose add field is open
  sheet: null,
  removedMode: null, // a list key while it shows its removed items
  removedAll: false,
  swipeOpen: null, // data-key of the row swiped open
  swipeDir: "l",
  reorder: null,
  drag: null,
  lp: null, // long press pending
  g: null, // swipe gesture
  suppressClick: false,
  rendering: false,
  toastTimer: null,
  undoSnap: null,
  refreshing: false, // pulled to refresh, and syncing or checking for an update
};

export const openClass = (key) => (S.swipeOpen === key ? (S.swipeDir === "r" ? " open-r" : " open") : "");

export function applyTheme() {
  const r = document.documentElement;
  if (ui.theme === "auto") r.removeAttribute("data-app-theme");
  else r.setAttribute("data-app-theme", ui.theme);
}
