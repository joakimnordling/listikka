// Drawing the current view; the sheet and the toast have their own hosts and are drawn by sheets.js and toast.js.

import { updateSugg } from "./adding.js";
import { $ } from "./dom.js";
import { renderMain } from "./lists.js";
import { renderRemovedLists, renderSettings } from "./settings.js";
import { S, savePrefs, sync } from "./state.js";

export function render() {
  if (S.drag || S.reorder) return; // after the gesture
  S.rendering = true;
  const sc = $("#scroll");
  const top = sc && sc.dataset.view === S.view ? sc.scrollTop : 0;
  const app = $("#app");
  if (!S.loaded) app.innerHTML = `<header class="top"><h1>Listikka</h1></header><div class="loading">Loading…</div>`;
  else if (S.view === "main") app.innerHTML = renderMain();
  else if (S.view === "settings") app.innerHTML = renderSettings();
  else app.innerHTML = renderRemovedLists();
  const nsc = $("#scroll");
  if (nsc) {
    nsc.dataset.view = S.view;
    nsc.scrollTop = top;
  }
  if (S.adding !== null) {
    const inp = $("#add-input");
    if (inp) {
      inp.focus({ preventScroll: true });
      const n = inp.value.length;
      inp.setSelectionRange(n, n);
      updateSugg();
    }
  }
  savePrefs();
  S.rendering = false;
}

export function syncDot() {
  const s = sync.headerState();
  return s ? `<span class="dot${s === "bad" ? " bad" : ""}" aria-hidden="true"></span>` : "";
}
