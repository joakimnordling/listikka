// The lists and their items: drawing them, and ticking, editing and removing items.

import * as L from "../core/lists.js";
import { state } from "../core/records.js";
import { $, html } from "./dom.js";
import { svg } from "./icons.js";
import { installWay } from "./install.js";
import { onActs } from "./registry.js";
import { render, syncDot } from "./render.js";
import { openSheet } from "./sheets.js";
import {
  activeLists,
  byId,
  clock,
  getItem,
  getList,
  inRemoved,
  isOpen,
  itemsIn,
  listOf,
  liveItems,
  openClass,
  S,
  save,
  snapshot,
  store,
  sync,
  ui,
} from "./state.js";
import { toast } from "./toast.js";

// Until dismissed, a card at the bottom of the lists offers putting Listikka on the Home Screen (src/ui/install.js).
function installHint() {
  const way = installWay();
  if (!way || ui.installDismissed) return "";
  const act =
    way === "prompt"
      ? html`<button class="link" data-act="install">Install</button>`
      : html`<button class="link" data-act="install-steps">Show how</button>`;
  return html`<div class="install-hint">${svg("home")}<div><b>Put Listikka on your Home Screen</b><span>It then opens like an app, full screen, and works offline.</span>${act}</div><button class="x" data-act="install-dismiss" aria-label="Don't show again">${svg("x", 18)}</button></div>`;
}

export function renderMain() {
  const label = sync.headerState() === "bad" ? "Menu, a sync server has a problem" : "Menu";
  const h = [
    html`<header class="top"><h1>Listikka</h1><button class="icon-btn dot-host" data-act="app-menu" aria-label="${label}">${svg("more", 24)}${syncDot()}</button></header>`,
  ];
  h.push(html`<div class="scroll" id="scroll"><div class="lists">`);
  h.push(renderSection(""));
  for (const l of activeLists()) h.push(renderSection(l.id));
  const lists = activeLists().length;
  if (!lists) h.push(html`<button class="new-list" data-act="new-list">${svg("plus", 16)}New list</button>`);
  if (!lists && liveItems().length < 3 && !sync.servers.length)
    h.push(html`<p class="hint">Sharing with someone? Set up sync in Settings.</p>`);
  h.push(installHint());
  h.push(html`</div></div>`);
  return html`${h}`;
}

function renderSection(key) {
  const l = key ? getList(key) : null;
  const items = itemsIn(key);
  const open = isOpen(key);
  const hide = !!ui.hide[key];
  const rm = inRemoved(key);
  const label = l ? l.name : "Items without a list";
  const pending = L.uncheckedCount(items);
  const count = pending ? html`<span class="count" aria-label="${pending} unticked">${pending}</span>` : "";
  const h = [html`<section class="list" data-list="${key}">`];
  h.push(html`<div class="list-title" data-list-title="${key}">`);
  h.push(
    html`<button class="toggle" data-act="toggle" aria-expanded="${open}">${svg(open ? "chevDown" : "chevRight")}${l ? html`<span class="lname">${l.name}</span>` : html`<span aria-label="Items without a list" title="Items without a list">${svg("list", 22)}</span>`}${count}</button>`,
  );
  if (rm && open) h.push(html`<button class="chip" data-act="exit-removed">Removed items${svg("x", 14)}</button>`);
  if (open && !rm)
    h.push(
      html`<button class="icon-btn" data-act="eye" aria-pressed="${hide}" aria-label="${hide ? "Show" : "Hide"} ticked items">${svg(hide ? "eyeOff" : "eye")}</button>`,
    );
  h.push(html`<button class="icon-btn" data-act="menu" aria-label="More for ${label}">${svg("more")}</button>`);
  h.push(html`</div>`);
  if (open) {
    const shown = L.shownItems(items, { hideTicked: hide, showRemoved: rm });
    h.push(html`<ul class="items">${shown.map((i) => renderItem(i, rm))}</ul>`);
    if (hide && !rm) {
      const n = items.filter((i) => state(i) === "done").length;
      if (n) h.push(html`<div class="hidden-note">${n} ticked ${n === 1 ? "item" : "items"} hidden</div>`);
    }
    if (!rm) h.push(renderAdd(key, l));
  }
  return html`${h}</section>`;
}

function renderItem(i, rm) {
  const s = state(i);
  const removed = s === "hidden";
  const done = s === "done";
  const key = `i:${i.id}`;
  const action = removed
    ? html`<button data-act="delete-item">${svg("trash")}<span>Delete</span></button>`
    : html`<button data-act="remove-item">${svg("broom")}<span>Remove</span></button>`;
  const box = removed
    ? html`<span class="state-ic" title="Removed">${svg("broom", 20)}</span>`
    : html`<button class="box-btn" data-act="tick" role="checkbox" aria-checked="${done}" aria-label="${i.name}"><span class="box">${svg("check", 15)}</span></button>`;
  const lead = removed
    ? html`${svg("undo")}<span>Add back</span>`
    : done
      ? html`${svg("square")}<span>Untick</span>`
      : html`${svg("check")}<span>Tick</span>`;
  return html`<li class="item${done ? " done" : ""}${removed ? " removed removed-row" : ""}" data-id="${i.id}" data-key="${key}">
      <div class="swipe-act swipe-lead" aria-hidden="true"><span class="lead-in">${lead}</span></div><div class="swipe-act">${action}</div>
      <div class="row${openClass(key)}${removed ? " has-end" : ""}" data-swipe${rm ? "" : " data-hold"} data-right>${box}<button class="name" data-act="edit"><span class="nq"><span class="n">${i.name}</span>${i.q ? html` <span class="q">${i.q}</span>` : ""}</span>${i.note ? html`<span class="note">${i.note}</span>` : ""}</button>${removed ? html`<button class="box-btn" data-act="restore" aria-label="Add ${i.name} back">${svg("undo", 20)}</button>` : ""}</div>
    </li>`;
}

function renderAdd(key, l) {
  const label = l ? `Add to ${l.name}` : "Add item";
  if (S.adding === key) {
    return html`<form class="add" data-add="${key}" autocomplete="off"><div class="sugg" id="sugg"></div><div class="add-field">${svg("plus", 16)}<input id="add-input" name="item" aria-label="${label}" placeholder="${label}" value="${ui.drafts[key] || ""}" enterkeyhint="next"><button class="add-btn" type="submit"${ui.drafts[key]?.trim() ? "" : " hidden"}>Add</button></div></form>`;
  }
  const draft = ui.drafts[key];
  return html`<button class="add-row" data-act="add">${svg("plus", 16)}${draft ? html`<em>${draft}</em><span class="tag">Draft</span>` : html`<span>${label}</span>`}</button>`;
}

function sparkle(id) {
  const b = $(`li[data-id="${id}"] .box`);
  if (!b) return;
  b.classList.add("spark");
  setTimeout(() => b.classList.remove("spark"), 550);
}

export async function tickItem(item) {
  const was = state(item);
  await save([L.tick(item, clock)]);
  if (was !== "done") sparkle(item.id);
}

onActs({
  toggle: ({ key }) => {
    ui.open[key] = !isOpen(key);
    if (!ui.open[key]) {
      if (S.removedMode === key) S.removedMode = null;
      if (S.adding === key) S.adding = null;
    }
    render();
  },
  eye: ({ key }) => {
    ui.hide[key] = !ui.hide[key];
    render();
  },
  "exit-removed": () => {
    S.removedMode = null;
    S.removedAll = false;
    render();
  },
  tick: ({ item }) => {
    tickItem(item);
  },
  edit: ({ id }) => {
    openSheet({ type: "item", id, mode: "edit" });
  },
  "remove-item": ({ item }) => {
    const snap = snapshot([item]);
    S.swipeOpen = null;
    save([L.removeItem(item, clock)]).then(() => toast(`Removed ${item.name}`, snap));
  },
  restore: ({ item }) => {
    S.swipeOpen = null;
    save([L.addBack(item, listOf(item), store.items(), byId(), clock)]);
  },
  "delete-item": ({ id, item }) => {
    openSheet({
      type: "confirm",
      run: () => save([L.deleteItem(getItem(id), clock)]).then(() => toast("Deleted permanently")),
      title: `Delete ${item.name} permanently?`,
      body: "It goes from every device you share lists with, and won't come up as a suggestion again. This can't be undone.",
    });
  },
});
