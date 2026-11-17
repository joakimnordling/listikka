// Sheets: opening and closing them, the item sheet, and confirmations.

import * as L from "../core/lists.js";
import { canStep, stepQuantity } from "../core/quantity.js";
import { isLive, state } from "../core/records.js";
import { $, $$, html } from "./dom.js";
import { svg } from "./icons.js";
import { onActs, sheetBodies, sheetBody } from "./registry.js";
import { render } from "./render.js";
import { activeLists, byId, clock, getItem, getList, listName, listOf, S, save, snapshot, store, ui } from "./state.js";
import { toast } from "./toast.js";

export function openSheet(s) {
  S.sheet = s;
  renderSheet();
}
export function closeSheet() {
  S.sheet = null;
  $("#overlay").innerHTML = "";
  placeToast();
}

// While a sheet is open, the toast moves up above it, so it never covers the sheet's buttons and Undo stays in reach.
export function placeToast() {
  const t = $(".toast");
  if (!t) return;
  const s = $(".sheet");
  t.style.bottom = s ? `calc(${s.getBoundingClientRect().height + 12}px + var(--kb, 0px))` : "";
}

function listOptions(selected, item) {
  const opts = [["", "No list"], ...activeLists().map((l) => [l.id, l.name])];
  const cur = item?.list && getList(item.list);
  if (cur && isLive(cur) && state(cur) === "hidden") opts.push([cur.id, `${cur.name} (removed)`]);
  return opts.map(([v, n]) => html`<option value="${v}"${v === selected ? " selected" : ""}>${n}</option>`);
}

const addBackLabel = (key) => (key ? `Add to ${listName(key)}` : "Add back");

export function renderSheet() {
  const host = $("#overlay");
  if (!S.sheet) {
    host.innerHTML = "";
    return;
  }
  const err = html`<p class="err" role="alert"${S.sheet.error ? "" : " hidden"}>${S.sheet.error || ""}</p>`;
  const body = sheetBody(S.sheet.type, err);
  if (body === null) {
    closeSheet();
    return;
  }
  const focused = document.activeElement?.id;
  host.innerHTML = html`<div class="scrim" data-act="scrim"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="grab"></div>${body}</div>`;
  const keep = focused && $(`#${focused}`, host);
  const first =
    keep ||
    $("#f-lname") ||
    $("#f-url") ||
    $("#p0") ||
    $("#p1") ||
    (S.sheet.type === "item" ? null : $(".sheet button"));
  if (first) first.focus();
  placeToast();
}

// − and + at the right end of the quantity, where the thumb reaches (src/core/quantity.js)
function qtyButtons(q) {
  const show = canStep(q) ? "" : " hidden";
  const off = stepQuantity(q, -1) === null ? " disabled" : "";
  return html`<button type="button" class="step" data-act="q-down" aria-label="Less"${show}${off}>${svg("minus", 20)}</button><button type="button" class="step" data-act="q-up" aria-label="More"${show}>${svg("plus", 20)}</button>`;
}
function syncQtyButtons() {
  const q = $("#f-q")?.value;
  for (const b of $$(".qty .step")) b.hidden = !canStep(q);
  const down = $('.qty [data-act="q-down"]');
  if (down) down.disabled = stepQuantity(q, -1) === null;
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
  const i = getItem(S.sheet.id);
  const fields = i && isLive(i) ? readItemFields(i) : null;
  closeSheet();
  if (fields) save([L.editItem(i, fields, store.items(), byId(), clock)]);
  else render();
}

onActs({
  scrim: () => {
    if (S.sheet?.type === "item" && S.sheet.mode === "edit") finishEdit();
    else if (!S.sheet?.busy) {
      closeSheet();
      if (S.adding !== null) render();
    }
  },
  "close-sheet": () => {
    closeSheet();
    render();
  },
  "sheet-done": () => {
    finishEdit();
  },
  "sheet-remove": () => {
    const i = getItem(S.sheet.id);
    const snap = snapshot([i]);
    const edited = L.editItem(i, readItemFields(i), store.items(), byId(), clock);
    closeSheet();
    save([L.removeItem(edited, clock)]).then(() => toast(`Removed ${i.name}`, snap));
  },
  "addback-confirm": () => {
    const i = getItem(S.sheet.id);
    const f = readItemFields(i);
    const back = L.addBack(i, f.list, store.items(), byId(), clock, f);
    if (S.adding !== null) {
      delete ui.drafts[S.adding];
      const inp = $("#add-input");
      if (inp) inp.value = "";
    }
    closeSheet();
    save([back]).then(() => $(`li[data-id="${i.id}"]`)?.scrollIntoView({ block: "nearest" }));
  },
  "q-up": ({ act }) => {
    const inp = $("#f-q");
    const next = stepQuantity(inp.value, act === "q-up" ? 1 : -1);
    if (next !== null) inp.value = next;
    syncQtyButtons();
  },
  "q-down": ({ act }) => {
    const inp = $("#f-q");
    const next = stepQuantity(inp.value, act === "q-up" ? 1 : -1);
    if (next !== null) inp.value = next;
    syncQtyButtons();
  },
  "confirm-yes": () => {
    const s = S.sheet;
    closeSheet();
    S.swipeOpen = null;
    s.run();
  },
});

sheetBodies({
  item: () => {
    const i = getItem(S.sheet.id);
    if (!i || !isLive(i)) return null;
    const addback = S.sheet.mode === "addback";
    const lk = addback ? S.sheet.key : listOf(i);
    const title = addback ? "Add back" : state(i) === "hidden" ? "Removed item" : "Item";
    const buttons = addback
      ? html`<button class="primary" data-act="addback-confirm" id="addback-btn">${addBackLabel(lk)}</button><button class="quiet" data-act="close-sheet">Cancel</button>`
      : html`${state(i) !== "hidden" ? html`<button class="quiet" data-act="sheet-remove">${svg("broom", 18)}Remove from list</button>` : ""}<button class="primary" data-act="sheet-done">Done</button>`;
    return html`<h2 id="sheet-title">${title}</h2>
        <label class="field">Name<input id="f-name" value="${i.name}"></label>
        <div class="field"><label for="f-q">Quantity</label><div class="qty"><input id="f-q" value="${i.q || ""}">${qtyButtons(i.q)}</div></div>
        <label class="field">List<span class="select"><select id="f-list">${listOptions(lk, i)}</select></span></label>
        <label class="field">Note<input id="f-note" value="${i.note || ""}"></label>${buttons}`;
  },
  confirm: (err) => {
    return html`<h2 id="sheet-title">${S.sheet.title}</h2><p>${S.sheet.body}</p>${err}
        <button class="danger" data-act="confirm-yes">${svg(S.sheet.icon || "trash", 18)}${S.sheet.yes || "Delete permanently"}</button>
        <button class="primary" data-act="close-sheet">Cancel</button>`;
  },
  notice: () => {
    return html`<h2 id="sheet-title">${S.sheet.title}</h2><p>${S.sheet.body}</p>
        <button class="primary" data-act="close-sheet">Close</button>`;
  },
});

document.addEventListener("input", (e) => {
  if (e.target.id === "f-q") syncQtyButtons();
});
document.addEventListener("change", (e) => {
  if (e.target.id === "f-list" && S.sheet?.mode === "addback")
    $("#addback-btn").textContent = addBackLabel(e.target.value);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !S.sheet) return;
  e.preventDefault();
  if (S.sheet.type === "item" && S.sheet.mode === "edit") finishEdit();
  else if (!S.sheet.busy) closeSheet();
});
