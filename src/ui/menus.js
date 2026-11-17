// The header's ⋯ menu, each list's ⋯ menu, naming lists, and Add to Home Screen.

import * as L from "../core/lists.js";
import { state } from "../core/records.js";
import { $, html } from "./dom.js";
import { svg } from "./icons.js";
import { installWay, promptInstall } from "./install.js";
import { onActs, sheetBodies } from "./registry.js";
import { render, syncDot } from "./render.js";
import { closeSheet, openSheet } from "./sheets.js";
import { allKeys, clock, getList, inRemoved, isOpen, itemsIn, S, save, snapshot, store, ui } from "./state.js";
import { toast } from "./toast.js";

onActs({
  menu: ({ key }) => {
    openSheet({ type: "menu", key });
  },
  "app-menu": () => {
    openSheet({ type: "appmenu" });
  },
  "a-collapse": () => {
    for (const k of allKeys()) ui.open[k] = false;
    S.removedMode = null;
    S.adding = null;
    closeSheet();
    render();
  },
  "a-expand": () => {
    for (const k of allKeys()) ui.open[k] = true;
    closeSheet();
    render();
  },
  "a-show-removed": () => {
    S.removedAll = true;
    S.adding = null;
    closeSheet();
    render();
  },
  "a-hide-removed": () => {
    S.removedAll = false;
    S.removedMode = null;
    closeSheet();
    render();
  },
  "a-hide-ticked": () => {
    for (const k of allKeys()) ui.hide[k] = true;
    closeSheet();
    render();
  },
  "a-show-ticked": () => {
    for (const k of allKeys()) ui.hide[k] = false;
    closeSheet();
    render();
  },
  install: () => {
    if (installWay() === "prompt") {
      closeSheet();
      promptInstall().then(render);
    } else openSheet({ type: "install" });
  },
  "install-steps": () => {
    openSheet({ type: "install" });
  },
  "install-dismiss": () => {
    ui.installDismissed = true;
    render();
  },
  "a-settings": () => {
    closeSheet();
    S.view = "settings";
    S.adding = null;
    render();
  },
  "m-remove-ticked": () => {
    const done = itemsIn(S.sheet.key).filter((i) => state(i) === "done");
    const snap = snapshot(done);
    closeSheet();
    save(L.removeTicked(done, clock)).then(() =>
      toast(`Removed ${done.length} ticked ${done.length === 1 ? "item" : "items"}`, snap),
    );
  },
  "m-show-removed": () => {
    S.removedMode = S.sheet.key;
    ui.open[S.sheet.key] = true;
    if (S.adding === S.sheet.key) S.adding = null;
    closeSheet();
    render();
  },
  "m-hide-removed": () => {
    S.removedMode = null;
    S.removedAll = false;
    closeSheet();
    render();
  },
  "m-rename": () => {
    openSheet({ type: "name", id: S.sheet.key });
  },
  "new-list": () => {
    S.adding = null;
    openSheet({ type: "name", id: null });
  },
  "m-remove-list": () => {
    const l = getList(S.sheet.key);
    const snap = snapshot([l]);
    if (S.removedMode === l.id) S.removedMode = null;
    if (S.adding === l.id) S.adding = null;
    closeSheet();
    save([L.removeList(l, clock)]).then(() => toast(`Removed ${l.name}`, snap));
  },
});

sheetBodies({
  menu: () => {
    const key = S.sheet.key;
    const l = key ? getList(key) : null;
    const items = itemsIn(key);
    const nDone = items.filter((i) => state(i) === "done").length;
    const nHidden = items.filter((i) => state(i) === "hidden").length;
    const m = [];
    if (nDone)
      m.push(html`<button data-act="m-remove-ticked">${svg("broomSparkles")}Remove ticked (${nDone})</button>`);
    if (inRemoved(key)) m.push(html`<button data-act="m-hide-removed">${svg("eyeOff")}Hide removed items</button>`);
    else if (nHidden)
      m.push(html`<button data-act="m-show-removed">${svg("broom")}Show removed items (${nHidden})</button>`);
    if (l) m.push(html`<button data-act="m-rename">${svg("pencil")}Rename</button>`);
    m.push(html`<button data-act="new-list">${svg("plus")}New list</button>`);
    if (l) m.push(html`<button class="warn" data-act="m-remove-list">${svg("broom")}Remove list</button>`);
    return html`<h2 id="sheet-title">${l ? l.name : "Items without a list"}</h2><div class="menu">${m}</div><button class="primary" data-act="close-sheet">Cancel</button>`;
  },
  appmenu: () => {
    const anyOpen = allKeys().some(isOpen);
    const m = [html`<button data-act="new-list">${svg("plus")}New list</button>`];
    m.push(
      anyOpen
        ? html`<button data-act="a-collapse">${svg("chevRight")}Collapse all</button>`
        : html`<button data-act="a-expand">${svg("chevDown")}Expand all</button>`,
    );
    const anyShown = allKeys().some((k) => !ui.hide[k]);
    m.push(
      anyShown
        ? html`<button data-act="a-hide-ticked">${svg("eyeOff")}Hide ticked items</button>`
        : html`<button data-act="a-show-ticked">${svg("eye")}Show ticked items</button>`,
    );
    m.push(
      S.removedAll
        ? html`<button data-act="a-hide-removed">${svg("eyeOff")}Hide removed items</button>`
        : html`<button data-act="a-show-removed">${svg("broom")}Show removed items</button>`,
    );
    if (installWay()) m.push(html`<button data-act="install">${svg("home")}Add to Home Screen</button>`);
    m.push(html`<button data-act="a-settings">${svg("cog")}Settings${syncDot()}</button>`);
    return html`<h2 id="sheet-title">Listikka</h2><div class="menu">${m}</div><button class="primary" data-act="close-sheet">Cancel</button>`;
  },
  name: () => {
    const l = S.sheet.id ? getList(S.sheet.id) : null;
    return html`<h2 id="sheet-title">${l ? "Rename list" : "New list"}</h2>
        <form id="name-form" autocomplete="off" style="display: contents"><label class="field">Name<input id="f-lname" value="${l ? l.name : ""}" placeholder="Shop or occasion"></label>
        <button class="primary" type="submit">${l ? "Save" : "Create list"}</button></form>`;
  },
  install: () => {
    return html`<h2 id="sheet-title">Add to Home Screen</h2>
        <p>Listikka then opens from its own icon, full screen like an app, and works offline.</p>
        <ol class="steps">
          <li><span>In Safari, tap <b>Share</b> <span class="ic">${svg("share", 16)}</span>. It's in the menu next to the address, or in the toolbar on older iOS versions.</span></li>
          <li><span>Tap <b>Add to Home Screen</b>. If it isn't there, tap <b>View more</b> first.</span></li>
          <li><span>Tap <b>Add</b>.</span></li>
        </ol>
        <button class="primary" data-act="close-sheet">Done</button>`;
  },
});

document.addEventListener("submit", (e) => {
  if (e.target.id !== "name-form") return;
  e.preventDefault();
  const name = $("#f-lname").value.trim();
  if (!name) return;
  if (S.sheet.id) {
    const l = getList(S.sheet.id);
    closeSheet();
    save([L.renameList(l, name, clock)]);
  } else {
    const r = L.createList(name, store.lists(), clock);
    ui.open[r.id] = true;
    closeSheet();
    S.adding = r.id;
    save([r]).then(() => $(`section[data-list="${r.id}"]`)?.scrollIntoView({ block: "nearest" }));
  }
});
