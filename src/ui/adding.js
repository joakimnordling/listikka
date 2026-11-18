// The add field: what typing a name does, removed items offered back, and drafts.

import * as L from "../core/lists.js";
import { $, $$, html } from "./dom.js";
import { svg } from "./icons.js";
import { keepInView } from "./keyboard.js";
import { onActs } from "./registry.js";
import { render } from "./render.js";
import { openSheet } from "./sheets.js";
import { byId, clock, listName, listOf, S, save, savePrefs, store, ui } from "./state.js";

export function updateSugg() {
  const inp = $("#add-input");
  const box = $("#sugg");
  if (!inp || !box) return;
  if (inp.value) ui.drafts[S.adding] = inp.value;
  else delete ui.drafts[S.adding];
  savePrefs();
  const typed = inp.value.trim();
  // The button says what adding this name does here; an item already in the list shows first
  const a = L.addAction(typed, S.adding, store.items(), byId());
  const btn = $(".add-btn");
  if (btn) {
    btn.toggleAttribute("hidden", !typed);
    btn.textContent = ADD_LABEL[a.act];
  }
  for (const li of $$("li.item.match")) li.classList.remove("match");
  if (a.act === "again" || a.act === "untick") $(`li.item[data-id="${a.item.id}"]`)?.classList.add("match");
  const c = typed ? L.suggestions(typed, S.adding, store.items(), byId()) : [];
  // Removed items to bring back; the best match sits closest to the field.
  box.innerHTML = c
    .reverse()
    .map((i) => {
      const from = listOf(i) !== S.adding ? html`<span class="from">from ${listName(listOf(i))}</span>` : "";
      return html`<button type="button" class="sg" data-act="suggestion" data-sg="${i.id}">${svg("undo", 16)}<span>${i.name}</span>${i.q ? html`<span class="q">${i.q}</span>` : ""}${from}<span class="sg-act">Add back</span></button>`;
    })
    .join("");
  // Suggestions grow above the field and would push it under the keyboard
  keepInView($(".add-field"));
}

const ADD_LABEL = { new: "Add", again: "Add again", untick: "Untick", back: "Add back" };

// Adds what was typed, or, for a name already in this list, unticks it or brings it back (L.addAction).
async function addFresh(key = S.adding) {
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

onActs({
  add: ({ key }) => {
    S.adding = key;
    render();
  },
  suggestion: ({ b }) => {
    openSheet({ type: "item", id: b.dataset.sg, mode: "addback", key: S.adding });
  },
});

// Keep focus in the add field while picking a suggestion or tapping Add.
document.addEventListener("mousedown", (e) => {
  if (e.target.closest("[data-sg], .add-btn")) e.preventDefault();
});
document.addEventListener("submit", (e) => {
  if (!e.target.matches("form.add")) return;
  e.preventDefault();
  addFresh();
});
document.addEventListener("input", (e) => {
  if (e.target.id === "add-input") updateSugg();
});
// Leaving the add field, with Done above the keyboard or by tapping elsewhere, adds what was typed, as in
// Reminders. Escape, or leaving the app, keeps it as a draft instead.
document.addEventListener("focusout", (e) => {
  if (e.target.id !== "add-input" || S.rendering) return;
  setTimeout(() => {
    if (S.rendering || S.sheet) return;
    if (document.activeElement?.id !== "add-input" && S.adding !== null) {
      const key = S.adding;
      S.adding = null;
      if (document.visibilityState === "visible") addFresh(key);
      render();
    }
  }, 0);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented || S.sheet || S.adding === null) return;
  S.adding = null;
  render();
});
