/* Listikka: the screens. Lists and items live in the store (src/data/store.js) and sync through the servers set up
   in Settings; every change goes through the core's list actions (src/core/lists.js), so it gets its timestamps and
   merges with other devices' changes. Which lists are open, which hide ticked items, drafts and the theme are this
   device's own, kept in localStorage. */
import { DamagedKeyringError, WrongPassphraseError } from "../vendor/lokki-sync/crypto.js";
import { OtherAppError } from "../vendor/lokki-sync/engine.js";
import { backupText, parseBackup, planRestore } from "./core/backup.js";
import { createClock } from "./core/clock.js";
import * as L from "./core/lists.js";
import { EDITABLE, edit, isLive, state } from "./core/records.js";
import { BUILD, sourceUrl } from "./core/version.js";
import { zipOne } from "./core/zip.js";
import { clearCopy, clearEverything } from "./data/clear.js";
import { createIdb } from "./data/idb.js";
import { createStore } from "./data/store.js";
import { createSync, OTHER_APP } from "./sync/manager.js";
import { fileStamp, readText, saveFile } from "./ui/files.js";
import { svg } from "./ui/icons.js";
import { installWay, promptInstall, watchInstall } from "./ui/install.js";
import { keepInView, watchKeyboard } from "./ui/keyboard.js";
import { canScan, scanPairing } from "./ui/scan.js";
import { checkForUpdate, watchForUpdates } from "./ui/update.js";

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ---------- Data ---------- */
const clock = createClock();
const store = createStore(createIdb());
const sync = createSync(store);
// For the end-to-end tests (tests/e2e), as Lokki's window.__lokki
window.__listikka = { store, sync };

const byId = () => L.indexLists(store.lists());
const activeLists = () => L.activeLists(store.lists());
const removedLists = () => L.removedLists(store.lists());
const liveItems = () => store.items().filter(isLive);
const listOf = (i) => L.listKeyOf(i, byId());
const itemsIn = (key) => L.itemsIn(store.items(), key, byId());
const getItem = (id) => store.get("item", id);
const getList = (id) => store.get("list", id);
const listName = (key) => (key ? (getList(key)?.name ?? "") : "No list");

/** Save changes made here; the store merges them, tells the screen, and sync sends them soon. */
async function save(versions) {
  const changed = await store.change(versions.filter(Boolean));
  if (changed.length) sync.soon();
  return changed;
}

/** What undo needs: the records as they are now, to write their editable fields back with new timestamps. */
const snapshot = (records) => records.filter(Boolean).map((r) => structuredClone(r));
function undo(snap) {
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
let ui = { open: {}, hide: {}, drafts: {}, theme: "indigo", themeChosen: false };
let removedMode = null; // a list key while it shows its removed items
let removedAll = false;
try {
  ui = { ...ui, ...JSON.parse(localStorage.getItem(PREFS) || "{}") };
} catch {
  /* not kept in this browser */
}
if (!ui.themeChosen) ui.theme = "indigo";
function savePrefs() {
  try {
    localStorage.setItem(PREFS, JSON.stringify(ui));
  } catch {
    /* not kept in this browser */
  }
}
const isOpen = (key) => ui.open[key] !== false;
const inRemoved = (key) => removedAll || removedMode === key;
const allKeys = () => ["", ...activeLists().map((l) => l.id)];

/* ---------- Transient state ---------- */
let loaded = false;
let view = "main";
let adding = null; // list key whose add field is open
let sheet = null;
let swipeOpen = null; // data-key of the row swiped open
let swipeDir = "l";
let reorder = null;
let drag = null;
let lp = null; // long press pending
let g = null; // swipe gesture
let suppressClick = false;
let rendering = false;
let toastTimer = null;
let undoSnap = null;

const openClass = (key) => (swipeOpen === key ? (swipeDir === "r" ? " open-r" : " open") : "");

function applyTheme() {
  const r = document.documentElement;
  if (ui.theme === "auto") r.removeAttribute("data-app-theme");
  else r.setAttribute("data-app-theme", ui.theme);
}

/* ---------- Rendering ---------- */
function render() {
  if (drag || reorder) return; // after the gesture
  rendering = true;
  const sc = $("#scroll");
  const top = sc && sc.dataset.view === view ? sc.scrollTop : 0;
  const app = $("#app");
  if (!loaded) app.innerHTML = `<header class="top"><h1>Listikka</h1></header><div class="loading">Loading…</div>`;
  else if (view === "main") app.innerHTML = renderMain();
  else if (view === "settings") app.innerHTML = renderSettings();
  else app.innerHTML = renderRemovedLists();
  const nsc = $("#scroll");
  if (nsc) {
    nsc.dataset.view = view;
    nsc.scrollTop = top;
  }
  if (adding !== null) {
    const inp = $("#add-input");
    if (inp) {
      inp.focus({ preventScroll: true });
      const n = inp.value.length;
      inp.setSelectionRange(n, n);
      updateSugg();
    }
  }
  savePrefs();
  rendering = false;
}

function syncDot() {
  const s = sync.headerState();
  return s ? `<span class="dot${s === "bad" ? " bad" : ""}" aria-hidden="true"></span>` : "";
}

// Until dismissed, a card at the bottom of the lists offers putting Listikka on the Home Screen (src/ui/install.js).
function installHint() {
  const way = installWay();
  if (!way || ui.installDismissed) return "";
  const act =
    way === "prompt"
      ? `<button class="link" data-act="install">Install</button>`
      : `<button class="link" data-act="install-steps">Show how</button>`;
  return `<div class="install-hint">${svg("home")}<div><b>Put Listikka on your Home Screen</b><span>It then opens like an app, full screen, and works offline.</span>${act}</div><button class="x" data-act="install-dismiss" aria-label="Don't show again">${svg("x", 18)}</button></div>`;
}

function renderMain() {
  const label = sync.headerState() === "bad" ? "Menu, a sync server has a problem" : "Menu";
  let h = `<header class="top"><h1>Listikka</h1><button class="icon-btn dot-host" data-act="app-menu" aria-label="${label}">${svg("more", 24)}${syncDot()}</button></header>`;
  h += `<div class="scroll" id="scroll"><div class="lists">`;
  h += renderSection("");
  for (const l of activeLists()) h += renderSection(l.id);
  const lists = activeLists().length;
  if (!lists) h += `<button class="new-list" data-act="new-list">${svg("plus", 16)}New list</button>`;
  if (!lists && liveItems().length < 3 && !sync.servers.length)
    h += `<p class="hint">Sharing with someone? Set up sync in Settings.</p>`;
  h += installHint();
  h += `</div></div>`;
  return h;
}

function renderSection(key) {
  const l = key ? getList(key) : null;
  const items = itemsIn(key);
  const open = isOpen(key);
  const hide = !!ui.hide[key];
  const rm = inRemoved(key);
  const label = l ? l.name : "Items without a list";
  const pending = L.uncheckedCount(items);
  const count = pending ? `<span class="count" aria-label="${pending} unticked">${pending}</span>` : "";
  let h = `<section class="list" data-list="${key}">`;
  h += `<div class="list-title" data-list-title="${key}">`;
  h += `<button class="toggle" data-act="toggle" aria-expanded="${open}">${svg(open ? "chevDown" : "chevRight")}${l ? `<span class="lname">${esc(l.name)}</span>` : `<span aria-label="Items without a list" title="Items without a list">${svg("list", 22)}</span>`}${count}</button>`;
  if (rm && open) h += `<button class="chip" data-act="exit-removed">Removed items${svg("x", 14)}</button>`;
  if (open && !rm)
    h += `<button class="icon-btn" data-act="eye" aria-pressed="${hide}" aria-label="${hide ? "Show" : "Hide"} ticked items">${svg(hide ? "eyeOff" : "eye")}</button>`;
  h += `<button class="icon-btn" data-act="menu" aria-label="More for ${esc(label)}">${svg("more")}</button>`;
  h += `</div>`;
  if (open) {
    const shown = L.shownItems(items, { hideTicked: hide, showRemoved: rm });
    h += `<ul class="items">${shown.map((i) => renderItem(i, rm)).join("")}</ul>`;
    if (hide && !rm) {
      const n = items.filter((i) => state(i) === "done").length;
      if (n) h += `<div class="hidden-note">${n} ticked ${n === 1 ? "item" : "items"} hidden</div>`;
    }
    if (!rm) h += renderAdd(key, l);
  }
  return `${h}</section>`;
}

function renderItem(i, rm) {
  const s = state(i);
  const removed = s === "hidden";
  const done = s === "done";
  const key = `i:${i.id}`;
  const action = removed
    ? `<button data-act="delete-item">${svg("trash")}<span>Delete</span></button>`
    : `<button data-act="remove-item">${svg("broom")}<span>Remove</span></button>`;
  const box = removed
    ? `<span class="state-ic" title="Removed">${svg("broom", 20)}</span>`
    : `<button class="box-btn" data-act="tick" role="checkbox" aria-checked="${done}" aria-label="${esc(i.name)}"><span class="box">${svg("check", 15)}</span></button>`;
  const lead = removed
    ? `${svg("undo")}<span>Add back</span>`
    : done
      ? `${svg("square")}<span>Untick</span>`
      : `${svg("check")}<span>Tick</span>`;
  return `<li class="item${done ? " done" : ""}${removed ? " removed removed-row" : ""}" data-id="${i.id}" data-key="${key}">
      <div class="swipe-act swipe-lead" aria-hidden="true"><span class="lead-in">${lead}</span></div><div class="swipe-act">${action}</div>
      <div class="row${openClass(key)}${removed ? " has-end" : ""}" data-swipe${rm ? "" : " data-hold"} data-right>${box}<button class="name" data-act="edit"><span class="nq"><span class="n">${esc(i.name)}</span>${i.q ? ` <span class="q">${esc(i.q)}</span>` : ""}</span>${i.note ? `<span class="note">${esc(i.note)}</span>` : ""}</button>${removed ? `<button class="box-btn" data-act="restore" aria-label="Add ${esc(i.name)} back">${svg("undo", 20)}</button>` : ""}</div>
    </li>`;
}

function renderAdd(key, l) {
  const label = l ? `Add to ${esc(l.name)}` : "Add item";
  if (adding === key) {
    return `<form class="add" data-add="${key}" autocomplete="off"><div class="sugg" id="sugg"></div><div class="add-field">${svg("plus", 16)}<input id="add-input" name="item" aria-label="${label}" placeholder="${label}" value="${esc(ui.drafts[key] || "")}" enterkeyhint="next"><button class="add-btn" type="submit"${ui.drafts[key]?.trim() ? "" : " hidden"}>Add</button></div></form>`;
  }
  const draft = ui.drafts[key];
  return `<button class="add-row" data-act="add">${svg("plus", 16)}${draft ? `<em>${esc(draft)}</em><span class="tag">Draft</span>` : `<span>${label}</span>`}</button>`;
}

const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

function syncSummary() {
  const st = sync.status();
  if (!st.setUp && !st.servers.length)
    return "Off. Keep your lists on several devices through a server you choose, end-to-end encrypted.";
  if (!st.servers.length) return "No servers. Add one to sync.";
  if (st.failing) return "A server has a problem. Tap it to see.";
  if (st.unsynced) return `${st.unsynced} ${st.unsynced === 1 ? "change" : "changes"} waiting to sync.`;
  const n = st.servers.length;
  return `On, with ${n} ${n === 1 ? "server" : "servers"}. End-to-end encrypted.`;
}

function serverLine(s) {
  if (sync.running) return `<span>Syncing…</span>`;
  if (!s.last) return `<span>Not synced yet</span>`;
  if (!s.last.ok) return `<span class="bad">${esc(s.last.error || "Sync failed")}</span>`;
  return `<span>Synced ${ago(s.last.at)}${s.lacks ? ` · ${s.lacks} waiting` : ""}</span>`;
}

function renderSettings() {
  const themes = [
    ["auto", "Automatic"],
    ["light", "Light"],
    ["indigo", "Dark"],
    ["darker", "Darker"],
  ];
  const n = removedLists().length;
  const st = sync.status();
  const servers = st.servers
    .map(
      (s) =>
        `<button class="srow" data-act="server" data-bit="${s.bit}">${svg("server")}<span class="meta"><b>${esc(s.name)}</b>${serverLine(s)}</span>${svg("chevRight", 18)}</button>`,
    )
    .join("");
  return `<header class="top sub"><button class="icon-btn" data-act="back" aria-label="Back">${svg("back", 22)}</button><h1>Settings</h1></header>
    <div class="scroll" id="scroll"><div class="settings">
      <h2>Theme</h2>
      <div class="seg" role="group" aria-label="Theme">${themes.map(([v, t]) => `<button data-act="theme" data-v="${v}" aria-pressed="${ui.theme === v}">${t}</button>`).join("")}</div>
      <p class="text dim" style="padding-top: 8px">Dark is the default. Automatic follows the device: Light, or Dark when the device is in dark mode.</p>
      <h2>Sync</h2>
      <p class="text" id="sync-summary">${esc(syncSummary())}</p>
      ${servers}
      <button class="nav-row" data-act="add-server">${svg("plus")}Add server</button>
      ${st.servers.length ? `<button class="nav-row" data-act="sync-now" style="border-top: 0">${svg("refresh")}Sync now</button>` : ""}
      ${st.setUp ? `<button class="nav-row" data-act="change-pass" style="border-top: 0">${svg("pencil")}Change passphrase</button>` : ""}
      <h2>Lists</h2>
      <button class="nav-row" data-act="removed-lists">${svg("broom")}Removed lists<span class="count">${n}</span>${svg("chevRight", 18)}</button>
      <h2>Data</h2>
      <button class="nav-row" data-act="backup">${svg("download")}Back up</button>
      <button class="nav-row" data-act="restore-backup" style="border-top: 0">${svg("upload")}Restore from backup</button>
      <button class="nav-row" data-act="clear" style="border-top: 0">${svg("trash")}Clear data</button>
      <input type="file" id="restore-file" accept=".zip,.jsonl,.txt,application/zip" hidden>
      <p class="text dim" style="padding-top: 8px">Back up saves your lists to a file. Restoring merges a backup into the app: it shows what will change first, and nothing changed since the backup is overwritten.</p>
      <h2>About</h2>
      <p class="text">Listikka, lists for shopping and more.</p>
      <p class="text dim" id="version">Version ${esc(BUILD.version)}${BUILD.commit ? ` · ${esc(BUILD.commit.slice(0, 7))}` : ""}${BUILD.built ? ` · built ${esc(BUILD.built)}` : ""} · <a href="${esc(sourceUrl())}" target="_blank" rel="noopener" style="color: inherit">Source on GitHub</a></p>
      <button class="nav-row" data-act="check-update">${svg("refresh")}Check for updates<span class="count">Also checked by itself</span></button>
    </div></div>`;
}

function renderRemovedLists() {
  const lists = removedLists();
  const rows = lists
    .map((l) => {
      const n = liveItems().filter((i) => i.list === l.id).length;
      const key = `l:${l.id}`;
      return `<li class="item removed-row" data-lid="${l.id}" data-key="${key}">
        <div class="swipe-act swipe-lead" aria-hidden="true"><span class="lead-in">${svg("undo")}<span>Add back</span></span></div><div class="swipe-act"><button data-act="delete-list">${svg("trash")}<span>Delete</span></button></div>
        <div class="row lrow${openClass(key)}" data-swipe data-right><span class="meta"><b>${esc(l.name)}</b><span>${n} ${n === 1 ? "item" : "items"}</span></span><button class="box-btn" data-act="restore-list" aria-label="Add ${esc(l.name)} back">${svg("undo")}</button></div>
      </li>`;
    })
    .join("");
  const body = lists.length
    ? `<ul class="items">${rows}</ul><p class="empty">Tap the arrow or swipe right to add a list back with its items. Swipe left to delete it permanently.</p>`
    : `<p class="empty">No removed lists. A list removed from its ⋯ menu waits here until you add it back or delete it.</p>`;
  return `<header class="top sub"><button class="icon-btn" data-act="to-settings" aria-label="Back to Settings">${svg("back", 22)}</button><h1>Removed lists</h1></header>
      <div class="scroll" id="scroll">${body}</div>`;
}

/* ---------- Suggestions ---------- */
function updateSugg() {
  const inp = $("#add-input");
  const box = $("#sugg");
  if (!inp || !box) return;
  if (inp.value) ui.drafts[adding] = inp.value;
  else delete ui.drafts[adding];
  savePrefs();
  const typed = inp.value.trim();
  // The button says what adding this name does here; an item already in the list shows first
  const a = L.addAction(typed, adding, store.items(), byId());
  const btn = $(".add-btn");
  if (btn) {
    btn.toggleAttribute("hidden", !typed);
    btn.textContent = ADD_LABEL[a.act];
  }
  for (const li of $$("li.item.match")) li.classList.remove("match");
  if (a.act === "again" || a.act === "untick") $(`li.item[data-id="${a.item.id}"]`)?.classList.add("match");
  const c = typed ? L.suggestions(typed, adding, store.items(), byId()) : [];
  // Removed items to bring back; the best match sits closest to the field.
  box.innerHTML = c
    .reverse()
    .map((i) => {
      const from = listOf(i) !== adding ? `<span class="from">from ${esc(listName(listOf(i)))}</span>` : "";
      return `<button type="button" class="sg" data-sg="${i.id}">${svg("undo", 16)}<span>${esc(i.name)}</span>${i.q ? `<span class="q">${esc(i.q)}</span>` : ""}${from}<span class="sg-act">Add back</span></button>`;
    })
    .join("");
  // Suggestions grow above the field and would push it under the keyboard
  keepInView($(".add-field"));
}

const ADD_LABEL = { new: "Add", again: "Add again", untick: "Untick", back: "Add back" };

// Adds what was typed, or, for a name already in this list, unticks it or brings it back (L.addAction).
async function addFresh(key = adding) {
  const inp = $("#add-input");
  const name = inp?.value.trim();
  if (!name) return;
  const a = L.addAction(name, key, store.items(), byId());
  const r =
    a.act === "untick"
      ? L.tick(a.item, clock)
      : a.act === "back"
        ? L.addBack(a.item, key, store.items(), byId(), clock)
        : L.addItem(name, key, store.items(), byId(), clock);
  delete ui.drafts[key];
  if (inp) inp.value = "";
  await save([r]);
  $(`li[data-id="${r.id}"]`)?.scrollIntoView({ block: "nearest" });
}

/* ---------- Backups ---------- */
const count = (n, one) => (n ? `${n} ${n === 1 ? one : `${one}s`}` : "");

// A .zip holding the .jsonl backup (src/core/backup.js); without compression in the browser, the .jsonl as .txt.
async function backUp() {
  const day = fileStamp();
  const text = backupText([...store.lists(), ...store.items()]);
  try {
    const ok =
      typeof CompressionStream === "function"
        ? await saveFile(
            `listikka-backup-${day}.zip`,
            await zipOne(`listikka-backup-${day}.jsonl`, new TextEncoder().encode(text)),
          )
        : await saveFile(`listikka-backup-${day}.txt`, text);
    if (ok) toast("Backup saved");
  } catch (e) {
    toast(`The backup didn't finish: ${e?.message || "unknown error"}`);
  }
}

async function restoreFrom(file) {
  if (!file) return;
  const cant = (body) => openSheet({ type: "notice", title: "Can't restore", body });
  let text;
  try {
    text = await readText(file);
  } catch (e) {
    return cant(
      e?.message === "no-unzip"
        ? "This browser can't open .zip files. Unpack the backup and choose the .jsonl file inside."
        : "This file couldn't be read. It may be damaged or incomplete. Nothing was restored.",
    );
  }
  const b = parseBackup(text);
  if (b.error) return cant(b.error);
  openSheet({ type: "restore", header: b.header, plan: planRestore(b.records, (k, id) => store.get(k, id)) });
}

/* ---------- Sheets ---------- */
function openSheet(s) {
  sheet = s;
  renderSheet();
}
function closeSheet() {
  sheet = null;
  $("#overlay").innerHTML = "";
  placeToast();
}

// While a sheet is open, the toast moves up above it, so it never covers the sheet's buttons and Undo stays in reach.
function placeToast() {
  const t = $(".toast");
  if (!t) return;
  const s = $(".sheet");
  t.style.bottom = s ? `calc(${s.getBoundingClientRect().height + 12}px + var(--kb, 0px))` : "";
}

function listOptions(selected, item) {
  const opts = [["", "No list"], ...activeLists().map((l) => [l.id, l.name])];
  const cur = item?.list && getList(item.list);
  if (cur && isLive(cur) && state(cur) === "hidden") opts.push([cur.id, `${cur.name} (removed)`]);
  return opts.map(([v, n]) => `<option value="${v}"${v === selected ? " selected" : ""}>${esc(n)}</option>`).join("");
}

const addBackLabel = (key) => (key ? `Add to ${esc(listName(key))}` : "Add back");

function strength(p) {
  let n = 0;
  if (p.length >= 10) n++;
  if (p.length >= 16) n++;
  if (/[^a-zA-Z]/.test(p) || /\s|-/.test(p)) n++;
  if (p.length >= 24) n++;
  return n;
}

function renderSheet() {
  const host = $("#overlay");
  if (!sheet) {
    host.innerHTML = "";
    return;
  }
  let body = "";
  const err = `<p class="err" role="alert"${sheet.error ? "" : " hidden"}>${esc(sheet.error || "")}</p>`;
  if (sheet.type === "item") {
    const i = getItem(sheet.id);
    if (!i || !isLive(i)) {
      closeSheet();
      return;
    }
    const addback = sheet.mode === "addback";
    const lk = addback ? sheet.key : listOf(i);
    const title = addback ? "Add back" : state(i) === "hidden" ? "Removed item" : "Item";
    body = `<h2 id="sheet-title">${title}</h2>
        <label class="field">Name<input id="f-name" value="${esc(i.name)}"></label>
        <div class="two"><label class="field">Quantity<input id="f-q" value="${esc(i.q || "")}"></label>
        <label class="field">List<select id="f-list">${listOptions(lk, i)}</select></label></div>
        <label class="field">Note<input id="f-note" value="${esc(i.note || "")}"></label>`;
    if (addback)
      body += `<button class="primary" data-act="addback-confirm" id="addback-btn">${addBackLabel(lk)}</button><button class="quiet" data-act="close-sheet">Cancel</button>`;
    else
      body += `${state(i) !== "hidden" ? `<button class="quiet" data-act="sheet-remove">${svg("broom", 18)}Remove from list</button>` : ""}<button class="primary" data-act="sheet-done">Done</button>`;
  } else if (sheet.type === "menu") {
    const key = sheet.key;
    const l = key ? getList(key) : null;
    const items = itemsIn(key);
    const nDone = items.filter((i) => state(i) === "done").length;
    const nHidden = items.filter((i) => state(i) === "hidden").length;
    let m = "";
    if (nDone) m += `<button data-act="m-remove-ticked">${svg("broomSparkles")}Remove ticked (${nDone})</button>`;
    if (inRemoved(key)) m += `<button data-act="m-hide-removed">${svg("eyeOff")}Hide removed items</button>`;
    else if (nHidden) m += `<button data-act="m-show-removed">${svg("broom")}Show removed items (${nHidden})</button>`;
    if (l) m += `<button data-act="m-rename">${svg("pencil")}Rename</button>`;
    m += `<button data-act="new-list">${svg("plus")}New list</button>`;
    if (l) m += `<button class="warn" data-act="m-remove-list">${svg("broom")}Remove list</button>`;
    body = `<h2 id="sheet-title">${l ? esc(l.name) : "Items without a list"}</h2><div class="menu">${m}</div><button class="primary" data-act="close-sheet">Cancel</button>`;
  } else if (sheet.type === "appmenu") {
    const anyOpen = allKeys().some(isOpen);
    let m = `<button data-act="new-list">${svg("plus")}New list</button>`;
    m += anyOpen
      ? `<button data-act="a-collapse">${svg("chevRight")}Collapse all</button>`
      : `<button data-act="a-expand">${svg("chevDown")}Expand all</button>`;
    const anyShown = allKeys().some((k) => !ui.hide[k]);
    m += anyShown
      ? `<button data-act="a-hide-ticked">${svg("eyeOff")}Hide ticked items</button>`
      : `<button data-act="a-show-ticked">${svg("eye")}Show ticked items</button>`;
    m += removedAll
      ? `<button data-act="a-hide-removed">${svg("eyeOff")}Hide removed items</button>`
      : `<button data-act="a-show-removed">${svg("broom")}Show removed items</button>`;
    if (installWay()) m += `<button data-act="install">${svg("home")}Add to Home Screen</button>`;
    m += `<button data-act="a-settings">${svg("cog")}Settings${syncDot()}</button>`;
    body = `<h2 id="sheet-title">Listikka</h2><div class="menu">${m}</div><button class="primary" data-act="close-sheet">Cancel</button>`;
  } else if (sheet.type === "name") {
    const l = sheet.id ? getList(sheet.id) : null;
    body = `<h2 id="sheet-title">${l ? "Rename list" : "New list"}</h2>
        <form id="name-form" autocomplete="off" style="display: contents"><label class="field">Name<input id="f-lname" value="${esc(l ? l.name : "")}" placeholder="Shop or occasion"></label>
        <button class="primary" type="submit">${l ? "Save" : "Create list"}</button></form>`;
  } else if (sheet.type === "confirm") {
    body = `<h2 id="sheet-title">${esc(sheet.title)}</h2><p>${esc(sheet.body)}</p>${err}
        <button class="danger" data-act="confirm-yes">${svg(sheet.icon || "trash", 18)}${esc(sheet.yes || "Delete permanently")}</button>
        <button class="primary" data-act="close-sheet">Cancel</button>`;
  } else if (sheet.type === "install") {
    body = `<h2 id="sheet-title">Add to Home Screen</h2>
        <p>Listikka then opens from its own icon, full screen like an app, and works offline.</p>
        <ol class="steps">
          <li><span>In Safari, tap <b>Share</b> <span class="ic">${svg("share", 16)}</span>. It's in the menu next to the address, or in the toolbar on older iOS versions.</span></li>
          <li><span>Tap <b>Add to Home Screen</b>. If it isn't there, tap <b>View more</b> first.</span></li>
          <li><span>Tap <b>Add</b>.</span></li>
        </ol>
        <button class="primary" data-act="close-sheet">Done</button>`;
  } else if (sheet.type === "notice") {
    body = `<h2 id="sheet-title">${esc(sheet.title)}</h2><p>${esc(sheet.body)}</p>
        <button class="primary" data-act="close-sheet">Close</button>`;
  } else if (sheet.type === "restore") {
    const p = sheet.plan;
    const at = new Date(sheet.header.exported);
    const when = Number.isNaN(+at)
      ? ""
      : `Made ${at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. `;
    const adds = [count(p.added.list, "list"), count(p.added.item, "item")].filter(Boolean).join(" and ");
    const changes = [count(p.changed.list, "list"), count(p.changed.item, "item")].filter(Boolean).join(" and ");
    const what = [adds && `adds ${adds}`, changes && `updates ${changes}`].filter(Boolean).join(", and ");
    body = `<h2 id="sheet-title">Restore from backup</h2>
        <p>${when}The backup has ${count(p.has.list, "list") || "no lists"} and ${count(p.has.item, "item") || "no items"}.</p>
        <p id="restore-plan">${what ? `Restoring ${what}. Nothing changed here since the backup is overwritten.` : "Nothing to restore: Listikka already has everything in this backup."}</p>
        ${what ? `<button class="primary" data-act="restore-confirm">Restore</button><button class="quiet" data-act="close-sheet">Cancel</button>` : `<button class="primary" data-act="close-sheet">Close</button>`}`;
  } else if (sheet.type === "clear") {
    const st = sync.status();
    const synced = st.setUp && st.servers.length;
    const lost = synced ? st.unsynced : 0;
    body = synced
      ? `<h2 id="sheet-title">Clear data</h2>
        <p>This removes data from this device only. Your servers keep your lists.</p>
        ${lost ? `<p class="err">${lost === 1 ? "1 change hasn't" : `${lost} changes haven't`} reached any server yet and would be lost. Sync first, or back up.</p>` : ""}
        <div class="menu"><button data-act="clear-copy">${svg("refresh")}Clear and download again</button></div>
        <p>Removes this device's copy of your lists and downloads it again. Your sync setup and settings stay.</p>
        <button class="danger" data-act="clear-all">${svg("trash", 18)}Clear everything</button>
        <p>Also removes the sync setup and this device's settings. To sync again, you'll need each server's URL and token, and your passphrase.</p>
        <button class="primary" data-act="close-sheet">Cancel</button>`
      : `<h2 id="sheet-title">Clear data</h2>
        <p>Your lists are saved only on this device. Clearing removes them for good, unless you have a backup.</p>
        <div class="menu"><button data-act="clear-backup">${svg("download")}Back up first</button></div>
        <button class="danger" data-act="clear-all">${svg("trash", 18)}Clear everything</button>
        <p>Removes your lists and this device's settings.</p>
        <button class="primary" data-act="close-sheet">Cancel</button>`;
  } else if (sheet.type === "connect") {
    body = `<h2 id="sheet-title">Add server</h2>
      <p>Sync keeps your lists on several devices through a server you choose. Everything is encrypted on this device with a passphrase only you know; the server can't read it.</p>
      ${canScan() ? `<button type="button" class="scan-btn" data-act="scan"${sheet.busy ? " disabled" : ""}>${svg("scan")}Scan QR Code</button><div class="or">or type them</div>` : ""}
      <form id="connect-form" autocomplete="off" style="display: contents">
      <label class="field">URL<input id="f-url" type="url" inputmode="url" placeholder="https://sync.example.com" value="${esc(sheet.url || "")}" autocapitalize="off" spellcheck="false"></label>
      <label class="field">Token<input id="f-token" placeholder="lk_…" value="${esc(sheet.token || "")}" autocapitalize="off" spellcheck="false"></label>
      ${err}<button class="primary" type="submit" data-busy="Connecting…">Connect</button></form>`;
  } else if (sheet.type === "passphrase") {
    const fresh = !sheet.keyring;
    body = fresh
      ? `<h2 id="sheet-title">New passphrase</h2>
      <p>The passphrase encrypts your lists before they leave this device. Keep it somewhere safe, such as a password manager: if you forget it, nobody can open the data on servers. Devices already set up keep working.</p>
      <form id="pass-form" autocomplete="off" style="display: contents">
      <label class="field">Passphrase<input id="p1" type="password" autocomplete="new-password"></label>
      <div class="meter" id="meter" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <label class="field">Again<input id="p2" type="password" autocomplete="new-password"></label>
      ${err}<button class="primary" type="submit" data-busy="Setting up…">Start syncing</button></form>`
      : `<h2 id="sheet-title">Passphrase</h2>
      <p>This server already holds your lists. Enter the passphrase you chose when you set up sync. Lists already on this device are added to them.</p>
      <form id="pass-form" autocomplete="off" style="display: contents">
      <label class="field">Passphrase<input id="p1" type="password" autocomplete="current-password"></label>
      ${err}<button class="primary" type="submit" data-busy="Opening…">Join</button></form>`;
  } else if (sheet.type === "change-pass") {
    body = `<h2 id="sheet-title">Change passphrase</h2>
      <p>The new passphrase opens your lists on servers from now on. Devices already set up keep working without it.</p>
      <form id="change-form" autocomplete="off" style="display: contents">
      <label class="field">Current<input id="p0" type="password" autocomplete="current-password"></label>
      <label class="field">New<input id="p1" type="password" autocomplete="new-password"></label>
      <div class="meter" id="meter" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <label class="field">Again<input id="p2" type="password" autocomplete="new-password"></label>
      ${err}<button class="primary" type="submit" data-busy="Changing…">Change</button></form>
      <button class="quiet" data-act="close-sheet">Cancel</button>`;
  } else if (sheet.type === "server") {
    const s = sync.status().servers.find((x) => x.bit === sheet.bit);
    if (!s) {
      closeSheet();
      return;
    }
    body = `<h2 id="sheet-title">${esc(s.name)}</h2>
      <p>${esc(s.url)}<br>${s.last ? (s.last.ok ? `Synced ${ago(s.last.at)}.` : esc(s.last.error || "Sync failed.")) : "Not synced yet."}${s.lacks ? ` ${s.lacks} ${s.lacks === 1 ? "change" : "changes"} waiting.` : ""}</p>
      <div class="menu"><button data-act="sync-now">${svg("refresh")}Sync now</button>
      <button class="warn" data-act="server-remove">${svg("x")}Stop using this server</button></div>
      <button class="primary" data-act="close-sheet">Done</button>`;
  }
  const focused = document.activeElement?.id;
  host.innerHTML = `<div class="scrim" data-act="scrim"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="grab"></div>${body}</div>`;
  const keep = focused && $(`#${focused}`, host);
  const first =
    keep || $("#f-lname") || $("#f-url") || $("#p0") || $("#p1") || (sheet.type === "item" ? null : $(".sheet button"));
  if (first) first.focus();
  placeToast();
}

function readItemFields(i) {
  return {
    name: $("#f-name").value.trim() || i.name,
    q: $("#f-q").value.trim(),
    note: $("#f-note").value.trim(),
    list: $("#f-list").value,
  };
}
function finishEdit() {
  const i = getItem(sheet.id);
  const fields = i && isLive(i) ? readItemFields(i) : null;
  closeSheet();
  if (fields) save([L.editItem(i, fields, store.items(), byId(), clock)]);
  else render();
}

/* ---------- Toast ---------- */
function toast(msg, snap) {
  clearTimeout(toastTimer);
  undoSnap = snap || null;
  $("#toast-host").innerHTML =
    `<div class="toast" role="status"><span>${esc(msg)}</span>${snap ? '<button data-act="undo">Undo</button>' : ""}</div>`;
  placeToast();
  toastTimer = setTimeout(() => {
    $("#toast-host").innerHTML = "";
    undoSnap = null;
  }, 5000);
}

function sparkle(id) {
  const b = $(`li[data-id="${id}"] .box`);
  if (!b) return;
  b.classList.add("spark");
  setTimeout(() => b.classList.remove("spark"), 550);
}

async function tickItem(item) {
  const was = state(item);
  await save([L.tick(item, clock)]);
  if (was !== "done") sparkle(item.id);
}

/* ---------- Sync setup ---------- */
function describeError(e) {
  if (e instanceof OtherAppError) return OTHER_APP;
  if (e?.status === 401) return "The server didn't accept the token. Check it, or ask for a new one.";
  if (e?.status === 0) return "Couldn't reach the server. Check the URL and your connection.";
  if (e?.status) return `The server answered with an error (${e.status}).`;
  return e?.message || "Something went wrong.";
}

/** A sheet's form while it works and after: its button and its error change in place, so what was typed stays. */
function setBusy(busy, error = null) {
  sheet = { ...sheet, busy, error };
  const btn = $(".sheet button[type=submit]");
  if (btn) {
    btn.dataset.idle ??= btn.textContent;
    btn.disabled = busy;
    btn.textContent = busy ? btn.dataset.busy : btn.dataset.idle;
  }
  for (const b of $$(".sheet .scan-btn")) b.disabled = busy;
  const err = $(".sheet .err");
  if (err) {
    err.textContent = error || "";
    err.hidden = !error;
  }
}

async function connect(url, token) {
  sheet = { ...sheet, url, token };
  const f = { url: $("#f-url"), token: $("#f-token") };
  if (f.url) f.url.value = url;
  if (f.token) f.token.value = token;
  setBusy(true);
  try {
    if (!/^https?:\/\/\S+$/.test(url)) throw new Error("Enter the server's address, starting with https://.");
    if (!token) throw new Error("Enter the token you got for this server.");
    const { keyring } = await sync.inspect(url, token);
    if (sync.vault) {
      await sync.addServer(url, token);
      closeSheet();
      render();
      return;
    }
    openSheet({ type: "passphrase", url, token, keyring });
  } catch (e) {
    setBusy(false, describeError(e));
  }
}

async function setPassphrase() {
  const p1 = $("#p1").value;
  const p2 = $("#p2")?.value;
  const { url, token, keyring } = sheet;
  setBusy(true);
  try {
    if (!keyring) {
      if (p1.length < 10) throw new Error("Use at least 10 characters; a few words work well.");
      if (p1 !== p2) throw new Error("The two passphrases differ.");
      await sync.createVault(p1);
    } else {
      await sync.joinVault(keyring, p1);
    }
    await sync.addServer(url, token);
    closeSheet();
    render();
    toast("Sync is on");
  } catch (e) {
    const msg =
      e instanceof WrongPassphraseError
        ? "That passphrase doesn't open this server's lists."
        : e instanceof DamagedKeyringError
          ? "The server's keys look damaged. Ask whoever runs the server."
          : describeError(e);
    setBusy(false, msg);
  }
}

async function changePassphrase() {
  const current = $("#p0").value;
  const next = $("#p1").value;
  setBusy(true);
  try {
    if (next.length < 10) throw new Error("Use at least 10 characters; a few words work well.");
    if (next !== $("#p2").value) throw new Error("The two new passphrases differ.");
    await sync.changePassphrase(current, next);
    closeSheet();
    render();
    toast("Passphrase changed");
  } catch (e) {
    setBusy(false, e instanceof WrongPassphraseError ? "That's not the current passphrase." : describeError(e));
  }
}

/* ---------- Clicks ---------- */
document.addEventListener(
  "click",
  (e) => {
    if (suppressClick) {
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const sg = e.target.closest("[data-sg]");
    if (sg) {
      e.preventDefault();
      openSheet({ type: "item", id: sg.dataset.sg, mode: "addback", key: adding });
      return;
    }
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    const sec = b.closest("[data-list]");
    const key = sec ? sec.dataset.list : sheet?.key;
    const li = b.closest("li[data-id]");
    const id = li?.dataset.id;
    const item = id ? getItem(id) : null;

    switch (act) {
      case "back":
        view = "main";
        render();
        break;
      case "to-settings":
        view = "settings";
        swipeOpen = null;
        render();
        break;
      case "removed-lists":
        view = "removed";
        swipeOpen = null;
        render();
        break;
      case "theme":
        ui.theme = b.dataset.v;
        ui.themeChosen = true;
        applyTheme();
        render();
        break;

      case "toggle":
        ui.open[key] = !isOpen(key);
        if (!ui.open[key]) {
          if (removedMode === key) removedMode = null;
          if (adding === key) adding = null;
        }
        render();
        break;
      case "eye":
        ui.hide[key] = !ui.hide[key];
        render();
        break;
      case "menu":
        openSheet({ type: "menu", key });
        break;
      case "exit-removed":
        removedMode = null;
        removedAll = false;
        render();
        break;
      case "app-menu":
        openSheet({ type: "appmenu" });
        break;
      case "a-collapse":
        for (const k of allKeys()) ui.open[k] = false;
        removedMode = null;
        adding = null;
        closeSheet();
        render();
        break;
      case "a-expand":
        for (const k of allKeys()) ui.open[k] = true;
        closeSheet();
        render();
        break;
      case "a-show-removed":
        removedAll = true;
        adding = null;
        closeSheet();
        render();
        break;
      case "a-hide-removed":
        removedAll = false;
        removedMode = null;
        closeSheet();
        render();
        break;
      case "a-hide-ticked":
        for (const k of allKeys()) ui.hide[k] = true;
        closeSheet();
        render();
        break;
      case "a-show-ticked":
        for (const k of allKeys()) ui.hide[k] = false;
        closeSheet();
        render();
        break;
      case "install":
        if (installWay() === "prompt") {
          closeSheet();
          promptInstall().then(render);
        } else openSheet({ type: "install" });
        break;
      case "install-steps":
        openSheet({ type: "install" });
        break;
      case "install-dismiss":
        ui.installDismissed = true;
        render();
        break;
      case "a-settings":
        closeSheet();
        view = "settings";
        adding = null;
        render();
        break;

      case "tick":
        tickItem(item);
        break;
      case "edit":
        openSheet({ type: "item", id, mode: "edit" });
        break;
      case "remove-item": {
        const snap = snapshot([item]);
        swipeOpen = null;
        save([L.removeItem(item, clock)]).then(() => toast(`Removed ${item.name}`, snap));
        break;
      }
      case "restore":
        swipeOpen = null;
        save([L.addBack(item, listOf(item), store.items(), byId(), clock)]);
        break;
      case "delete-item":
        openSheet({
          type: "confirm",
          what: "item",
          id,
          title: `Delete ${item.name} permanently?`,
          body: "It goes from every device you share lists with, and won't come up as a suggestion again. This can't be undone.",
        });
        break;
      case "add":
        adding = key;
        render();
        break;

      case "scrim":
        if (sheet?.type === "item" && sheet.mode === "edit") finishEdit();
        else if (!sheet?.busy) {
          closeSheet();
          if (adding !== null) render();
        }
        break;
      case "close-sheet":
        closeSheet();
        render();
        break;
      case "sheet-done":
        finishEdit();
        break;
      case "sheet-remove": {
        const i = getItem(sheet.id);
        const snap = snapshot([i]);
        const edited = L.editItem(i, readItemFields(i), store.items(), byId(), clock);
        closeSheet();
        save([L.removeItem(edited, clock)]).then(() => toast(`Removed ${i.name}`, snap));
        break;
      }
      case "addback-confirm": {
        const i = getItem(sheet.id);
        const f = readItemFields(i);
        const back = L.addBack(i, f.list, store.items(), byId(), clock, f);
        if (adding !== null) {
          delete ui.drafts[adding];
          const inp = $("#add-input");
          if (inp) inp.value = "";
        }
        closeSheet();
        save([back]).then(() => $(`li[data-id="${i.id}"]`)?.scrollIntoView({ block: "nearest" }));
        break;
      }

      case "m-remove-ticked": {
        const done = itemsIn(sheet.key).filter((i) => state(i) === "done");
        const snap = snapshot(done);
        closeSheet();
        save(L.removeTicked(done, clock)).then(() =>
          toast(`Removed ${done.length} ticked ${done.length === 1 ? "item" : "items"}`, snap),
        );
        break;
      }
      case "m-show-removed":
        removedMode = sheet.key;
        ui.open[sheet.key] = true;
        if (adding === sheet.key) adding = null;
        closeSheet();
        render();
        break;
      case "m-hide-removed":
        removedMode = null;
        removedAll = false;
        closeSheet();
        render();
        break;
      case "m-rename":
        openSheet({ type: "name", id: sheet.key });
        break;
      case "new-list":
        adding = null;
        openSheet({ type: "name", id: null });
        break;
      case "m-remove-list": {
        const l = getList(sheet.key);
        const snap = snapshot([l]);
        if (removedMode === l.id) removedMode = null;
        if (adding === l.id) adding = null;
        closeSheet();
        save([L.removeList(l, clock)]).then(() => toast(`Removed ${l.name}`, snap));
        break;
      }

      case "restore-list": {
        const l = getList(b.closest("[data-lid]").dataset.lid);
        swipeOpen = null;
        save([L.restoreList(l, clock)]).then(() => toast(`${l.name} is back`));
        break;
      }
      case "delete-list": {
        const l = getList(b.closest("[data-lid]").dataset.lid);
        openSheet({
          type: "confirm",
          what: "list",
          id: l.id,
          title: `Delete ${l.name} permanently?`,
          body: "The list and all the items in it are deleted from every device you share lists with. This can't be undone.",
        });
        break;
      }
      case "confirm-yes": {
        const s = sheet;
        closeSheet();
        swipeOpen = null;
        if (s.what === "item") save([L.deleteItem(getItem(s.id), clock)]).then(() => toast("Deleted permanently"));
        else if (s.what === "list")
          save(L.deleteList(getList(s.id), store.items(), clock)).then(() => toast("Deleted permanently"));
        else if (s.what === "clear-all") clearEverything(store.db);
        else if (s.what === "clear-copy") clearCopy(store.db, sync.servers);
        else if (s.what === "server")
          sync.removeServer(s.bit).then(() => {
            render();
            toast("Stopped using the server");
          });
        break;
      }
      case "undo":
        if (undoSnap) {
          const snap = undoSnap;
          undoSnap = null;
          undo(snap);
        }
        $("#toast-host").innerHTML = "";
        break;

      case "add-server":
        openSheet({ type: "connect" });
        break;
      case "scan":
        scanPairing(toast).then((found) => {
          if (found && sheet?.type === "connect") connect(found.url, found.token);
        });
        break;
      case "server":
        openSheet({ type: "server", bit: Number(b.dataset.bit) });
        break;
      case "sync-now":
        sync.now();
        break;
      case "check-update":
        checkForUpdate({ asked: true, say: toast });
        break;
      case "backup":
        backUp();
        break;
      case "restore-backup":
        $("#restore-file").click();
        break;
      case "restore-confirm": {
        const records = sheet.plan.records;
        closeSheet();
        save(records).then(() => toast("Backup restored"));
        break;
      }
      case "clear":
        openSheet({ type: "clear" });
        break;
      case "clear-backup":
        closeSheet();
        backUp();
        break;
      case "clear-copy": {
        const n = sync.servers.length;
        openSheet({
          type: "confirm",
          what: "clear-copy",
          title: "Clear and download again",
          body: `Remove this device's copy of your lists, and download it again from ${n > 1 ? "your servers" : "your server"}? This can't be undone.`,
          yes: "Clear and download again",
          icon: "refresh",
        });
        break;
      }
      case "clear-all": {
        const synced = sync.status().setUp && sync.servers.length;
        openSheet({
          type: "confirm",
          what: "clear-all",
          title: "Clear everything",
          body: synced
            ? "Remove your lists, the sync setup and this device's settings? This can't be undone."
            : "Remove your lists from this device for good? They aren't saved anywhere else. This can't be undone.",
          yes: "Clear everything",
        });
        break;
      }
      case "change-pass":
        openSheet({ type: "change-pass" });
        break;
      case "server-remove": {
        const s = sync.servers.find((x) => x.bit === sheet.bit);
        openSheet({
          type: "confirm",
          what: "server",
          bit: s.bit,
          title: `Stop using ${s.name}?`,
          body: "This device stops syncing with it. Your lists stay on this device, on the server and on your other devices.",
          yes: "Stop using it",
          icon: "x",
        });
        break;
      }
    }
  },
  true,
);

// Keep focus in the add field while picking a suggestion or tapping Add.
document.addEventListener("mousedown", (e) => {
  if (e.target.closest("[data-sg], .add-btn")) e.preventDefault();
});

document.addEventListener("submit", (e) => {
  e.preventDefault();
  if (e.target.id === "name-form") {
    const name = $("#f-lname").value.trim();
    if (!name) return;
    if (sheet.id) {
      const l = getList(sheet.id);
      closeSheet();
      save([L.renameList(l, name, clock)]);
    } else {
      const r = L.createList(name, store.lists(), clock);
      ui.open[r.id] = true;
      closeSheet();
      adding = r.id;
      save([r]).then(() => $(`section[data-list="${r.id}"]`)?.scrollIntoView({ block: "nearest" }));
    }
  } else if (e.target.id === "connect-form") connect($("#f-url").value.trim(), $("#f-token").value.trim());
  else if (e.target.id === "pass-form") setPassphrase();
  else if (e.target.id === "change-form") changePassphrase();
  else if (e.target.matches("form.add")) addFresh();
});

document.addEventListener("input", (e) => {
  if (e.target.id === "add-input") updateSugg();
  if (e.target.id === "p1" && $("#meter")) {
    const n = strength(e.target.value);
    $$("#meter span").forEach((s, k) => {
      s.classList.toggle("on", k < n);
    });
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "restore-file") {
    restoreFrom(e.target.files[0]);
    e.target.value = "";
  }
  if (e.target.id === "f-list" && sheet?.mode === "addback") $("#addback-btn").innerHTML = addBackLabel(e.target.value);
});
// Leaving the add field, with Done above the keyboard or by tapping elsewhere, adds what was typed, as in
// Reminders. Escape, or leaving the app, keeps it as a draft instead.
document.addEventListener("focusout", (e) => {
  if (e.target.id !== "add-input" || rendering) return;
  setTimeout(() => {
    if (rendering || sheet) return;
    if (document.activeElement?.id !== "add-input" && adding !== null) {
      const key = adding;
      adding = null;
      if (document.visibilityState === "visible") addFresh(key);
      render();
    }
  }, 0);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (sheet) {
    if (sheet.type === "item" && sheet.mode === "edit") finishEdit();
    else if (!sheet.busy) closeSheet();
  } else if (adding !== null) {
    adding = null;
    render();
  }
});

/* ---------- Swipe, item drag, list reorder ---------- */
function closeSwipe() {
  if (!swipeOpen) return;
  const row = $(`li[data-key="${swipeOpen}"] .row`);
  if (row) {
    row.style.transform = "";
    row.classList.remove("open", "open-r");
  }
  swipeOpen = null;
}

document.addEventListener("pointerdown", (e) => {
  if (e.button) return;
  suppressClick = false;
  if (sheet) return;
  if (swipeOpen && !e.target.closest(`li[data-key="${swipeOpen}"]`)) {
    closeSwipe();
    suppressClick = true;
    return;
  }
  const title = e.target.closest("[data-list-title]");
  if (
    title &&
    view === "main" &&
    title.dataset.listTitle &&
    !e.target.closest('[data-act="menu"], [data-act="eye"], .chip')
  ) {
    const k = title.dataset.listTitle;
    lp = {
      x: e.clientX,
      y: e.clientY,
      pid: e.pointerId,
      timer: setTimeout(() => {
        const p = lp;
        lp = null;
        if (p) beginReorder(k, p.y, p.pid);
      }, 450),
    };
    return;
  }
  const row = e.target.closest("[data-swipe]");
  if (row) {
    const k = row.closest("li").dataset.key;
    g = {
      type: "pending",
      row,
      key: k,
      x: e.clientX,
      y: e.clientY,
      base: swipeOpen === k ? (swipeDir === "r" ? 88 : -88) : 0,
      dx: 0,
      right: row.hasAttribute("data-right"),
    };
    if (row.hasAttribute("data-hold") && view === "main") {
      const li = row.closest("li");
      lp = {
        x: e.clientX,
        y: e.clientY,
        pid: e.pointerId,
        timer: setTimeout(() => {
          const p = lp;
          lp = null;
          g = null;
          if (p) startItemDrag(li, p.x, p.y, p.pid);
        }, 450),
      };
    }
  }
});

window.addEventListener("pointermove", (e) => {
  if (lp) {
    if (Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 8) {
      clearTimeout(lp.timer);
      lp = null;
    } else {
      lp.x = e.clientX;
      lp.y = e.clientY;
    }
  }
  if (reorder) {
    moveReorder(e.clientY);
    return;
  }
  if (drag) {
    moveItemDrag(e.clientX, e.clientY);
    return;
  }
  if (!g) return;
  const dx = e.clientX - g.x;
  const dy = e.clientY - g.y;
  if (g.type === "pending") {
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      g.type = "swipe";
      g.row.style.transition = "none";
      suppressClick = true;
    } else if (Math.abs(dy) > 10) {
      g = null;
      return;
    }
  }
  if (g.type === "swipe") {
    if (!g.w) g.w = g.row.getBoundingClientRect().width;
    g.dx = Math.min(g.right ? g.w * 0.6 : 0, Math.max(-140, g.base + dx));
    g.row.style.transform = `translateX(${g.dx}px)`;
    const li = g.row.closest("li");
    const lead = li.querySelector(".swipe-lead");
    const trail = li.querySelector(".swipe-act:not(.swipe-lead)");
    const armed = g.dx >= 60; // the icon, in line with the checkboxes, sits centred in the green
    if (armed !== !!g.armed) {
      g.armed = armed;
      if (armed) navigator.vibrate?.(10);
    }
    if (lead) {
      lead.style.visibility = g.dx > 0 ? "visible" : "hidden";
      lead.classList.toggle("armed", armed);
    }
    if (trail) trail.style.visibility = g.dx < 0 ? "visible" : "hidden";
  }
});

// Swiping right acts at once: tick, untick, or add back.
function swipeRight(li) {
  if (li.dataset.lid) {
    const l = getList(li.dataset.lid);
    save([L.restoreList(l, clock)]).then(() => toast(`${l.name} is back`));
    return;
  }
  const it = getItem(li.dataset.id);
  if (!it) return;
  if (state(it) === "hidden") save([L.addBack(it, listOf(it), store.items(), byId(), clock)]);
  else tickItem(it);
}

function endGesture(cancelled) {
  if (lp) {
    clearTimeout(lp.timer);
    lp = null;
  }
  if (reorder) {
    endReorder(cancelled);
    return;
  }
  if (drag) {
    endItemDrag(cancelled);
    return;
  }
  if (g && g.type === "swipe") {
    g.row.style.transition = "";
    const li = g.row.closest("li");
    if (!cancelled && g.right && g.armed) {
      g.row.style.transform = "";
      if (swipeOpen === g.key) swipeOpen = null;
      g = null;
      swipeRight(li);
      return;
    }
    if (!cancelled && g.dx < -50) {
      if (swipeOpen && swipeOpen !== g.key) closeSwipe();
      swipeOpen = g.key;
      swipeDir = "l";
      g.row.style.transform = "";
      g.row.classList.remove("open", "open-r");
      g.row.classList.add("open");
    } else {
      g.row.style.transform = "";
      g.row.classList.remove("open", "open-r");
      if (swipeOpen === g.key) swipeOpen = null;
    }
  }
  g = null;
}
window.addEventListener("pointerup", () => endGesture(false));
window.addEventListener("pointercancel", () => endGesture(true));
document.addEventListener(
  "touchmove",
  (e) => {
    if (drag || reorder) e.preventDefault();
  },
  { passive: false },
);
document.addEventListener("contextmenu", (e) => {
  if (e.target.closest("[data-list-title], [data-hold]")) e.preventDefault();
});

// Keep receiving the pointer while rows move under it.
function capture(pid) {
  try {
    if (pid !== undefined && pid !== null) document.body.setPointerCapture(pid);
  } catch {
    /* not capturable */
  }
}

// Item move: press and hold a row. The held row stays in the page as a dashed slot and moves to where the item
// will land, as the held list does when reordering lists.
function startItemDrag(li, x, y, pid) {
  closeSwipe();
  if (!li.isConnected) return;
  const r = li.getBoundingClientRect();
  const ghost = li.cloneNode(true);
  ghost.classList.add("ghost");
  Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px` });
  document.body.appendChild(ghost);
  li.classList.add("dragging");
  capture(pid);
  suppressClick = true;
  navigator.vibrate?.(12);
  drag = { id: li.dataset.id, li, ghost, from: [li.parentNode, li.nextSibling], offY: y - r.top, lastY: y, lastX: x };
  drag.scrollTimer = setInterval(autoScroll, 16);
}
function autoScroll() {
  const sc = $("#scroll");
  if (!drag || !sc) return;
  const r = sc.getBoundingClientRect();
  if (drag.lastY < r.top + 60) sc.scrollTop -= 10;
  else if (drag.lastY > r.bottom - 60) sc.scrollTop += 10;
  else return;
  moveItemDrag(drag.lastX, drag.lastY);
}
function moveItemDrag(x, y) {
  drag.lastX = x;
  drag.lastY = y;
  drag.ghost.style.top = `${y - drag.offY}px`;
  const held = drag.li;
  const el = document.elementFromPoint(x, y);
  const sec = el?.closest("section[data-list]");
  if (!sec || el.closest("li.item") === held) return;
  for (const n of $$(".drop-into")) n.classList.remove("drop-into");
  const title = $(".list-title", sec);
  const ul = $(":scope > ul.items", sec);
  // A folded list, or one showing its removed items: the slot waits under the title and the item goes to the end
  if (!ul || $('[data-act="exit-removed"]', sec)) {
    if (title.nextElementSibling !== held) title.after(held);
    title.classList.add("drop-into");
    return;
  }
  const li = el.closest("li.item");
  let anchor;
  if (li && ul.contains(li)) {
    const r = li.getBoundingClientRect();
    anchor = y < r.top + r.height / 2 ? li : li.nextElementSibling;
  } else if (el.closest(".list-title")) anchor = ul.firstElementChild;
  else if (el.closest(".add-row, form.add, .hidden-note")) anchor = null;
  else return;
  if (anchor === held || (held.parentNode === ul && held.nextElementSibling === anchor)) return;
  ul.insertBefore(held, anchor);
}
function endItemDrag(cancelled) {
  clearInterval(drag.scrollTimer);
  drag.ghost.remove();
  for (const n of $$(".drop-into")) n.classList.remove("drop-into");
  const { id, li, from } = drag;
  drag = null;
  suppressClick = true;
  setTimeout(() => {
    suppressClick = false;
  }, 0);
  const it = getItem(id);
  const sec = li.closest("section[data-list]");
  const moved = li.parentNode !== from[0] || li.nextSibling !== from[1];
  if (cancelled || !moved || !it || !sec) {
    render();
    return;
  }
  // Placed after the row above it, or before the row below; ticked items hidden in between keep their places
  const inList = li.parentNode.matches("ul.items");
  const prev = inList && li.previousElementSibling;
  const next = inList && li.nextElementSibling;
  const where = prev ? { after: prev.dataset.id } : next ? { before: next.dataset.id } : {};
  save([L.moveItem(it, sec.dataset.list, itemsIn(sec.dataset.list), where, clock)]).then((changed) => {
    if (!changed.length) render();
  });
}

// List reorder: press and hold a title row. The lists fold with CSS and the held section moves in place, so the
// touched element stays in the page.
function beginReorder(k, y, pid) {
  if (!k || !getList(k)) return;
  capture(pid);
  closeSwipe();
  adding = null;
  const wrap = $(".lists");
  const held = $(`section[data-list="${k}"]`);
  if (!wrap || !held) return;
  wrap.classList.add("reordering");
  held.classList.add("held");
  suppressClick = true;
  navigator.vibrate?.(12);
  const app = $("#app").getBoundingClientRect();
  const gh = document.createElement("div");
  gh.className = "rghost";
  gh.innerHTML = `${svg("chevRight")}<span class="lname">${esc(getList(k).name)}</span>`;
  Object.assign(gh.style, { left: `${app.left + 6}px`, width: `${app.width - 12}px`, top: `${y - 26}px` });
  document.body.appendChild(gh);
  reorder = { id: k, wrap, held, ghost: gh, y };
  moveReorder(y);
}
function moveReorder(y) {
  reorder.y = y;
  reorder.ghost.style.top = `${y - 26}px`;
  const others = $$("section[data-list]", reorder.wrap).filter((s) => s.dataset.list && s !== reorder.held);
  let next = null;
  for (const s of others) {
    const b = s.getBoundingClientRect();
    if (b.top + b.height / 2 > y) {
      next = s;
      break;
    }
  }
  const anchor = next || $(".new-list", reorder.wrap) || null;
  if (reorder.held.nextElementSibling !== anchor) reorder.wrap.insertBefore(reorder.held, anchor);
  const sc = $("#scroll");
  if (sc) {
    const r = sc.getBoundingClientRect();
    if (y < r.top + 50) sc.scrollTop -= 8;
    else if (y > r.bottom - 50) sc.scrollTop += 8;
  }
}
function endReorder(cancelled) {
  const { id, wrap, ghost } = reorder;
  ghost.remove();
  reorder = null;
  suppressClick = true;
  setTimeout(() => {
    suppressClick = false;
  }, 0);
  const l = getList(id);
  if (cancelled || !l) {
    render();
    return;
  }
  const order = $$("section[data-list]", wrap)
    .map((s) => s.dataset.list)
    .filter(Boolean);
  const idx = order.indexOf(id);
  const others = activeLists().filter((x) => x.id !== id);
  const where = order[idx - 1] ? { after: order[idx - 1] } : order[idx + 1] ? { before: order[idx + 1] } : {};
  save([L.moveList(l, others, where, clock)]).then((changed) => {
    if (!changed.length) render();
  });
}

/* ---------- Start ---------- */
// The field being typed in stays above the keyboard, in the list or in a sheet.
const typingIn = () => {
  const a = document.activeElement;
  return a?.id === "add-input" ? $(".add-field") : a?.closest(".sheet") && a.matches("input, select") ? a : null;
};
watchKeyboard(() => keepInView(typingIn()));
document.addEventListener("focusin", () => setTimeout(() => keepInView(typingIn()), 0));

watchInstall(() => {
  if (view === "main") render();
});

store.onChange(() => {
  for (const r of [...store.lists(), ...store.items()]) clock.observeRecord(r);
  render();
  if (sheet && (sheet.type === "server" || sheet.type === "appmenu")) renderSheet();
});
sync.onChange(() => {
  if (view === "settings" || view === "main") render();
  if (sheet?.type === "server") renderSheet();
});

applyTheme();
render();
await store.load();
for (const r of [...store.lists(), ...store.items()]) clock.observeRecord(r);
await sync.load();
loaded = true;
render();
sync.start();
watchForUpdates();
