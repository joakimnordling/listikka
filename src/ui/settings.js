// Settings, and the removed lists under it.

import * as L from "../core/lists.js";
import { BUILD, sourceUrl } from "../core/version.js";
import { esc } from "./dom.js";
import { svg } from "./icons.js";
import { onActs } from "./registry.js";
import { render } from "./render.js";
import { openSheet } from "./sheets.js";
import { applyTheme, clock, getList, liveItems, openClass, removedLists, S, save, store, sync, ui } from "./state.js";
import { toast } from "./toast.js";
import { checkForUpdate } from "./update.js";

export const ago = (t) => {
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

export function renderSettings() {
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

export function renderRemovedLists() {
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

onActs({
  back: () => {
    S.view = "main";
    render();
  },
  "to-settings": () => {
    S.view = "settings";
    S.swipeOpen = null;
    render();
  },
  "removed-lists": () => {
    S.view = "removed";
    S.swipeOpen = null;
    render();
  },
  theme: ({ b }) => {
    ui.theme = b.dataset.v;
    ui.themeChosen = true;
    applyTheme();
    render();
  },
  "check-update": () => {
    checkForUpdate({ asked: true, say: toast });
  },
  "restore-list": ({ b }) => {
    const l = getList(b.closest("[data-lid]").dataset.lid);
    S.swipeOpen = null;
    save([L.restoreList(l, clock)]).then(() => toast(`${l.name} is back`));
  },
  "delete-list": ({ b }) => {
    const l = getList(b.closest("[data-lid]").dataset.lid);
    openSheet({
      type: "confirm",
      run: () => save(L.deleteList(getList(l.id), store.items(), clock)).then(() => toast("Deleted permanently")),
      title: `Delete ${l.name} permanently?`,
      body: "The list and all the items in it are deleted from every device you share lists with. This can't be undone.",
    });
  },
});
