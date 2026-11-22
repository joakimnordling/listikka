// Drawing the current view; the sheet and the toast have their own hosts and are drawn by sheets.js and toast.js.

import { updateSugg } from "./adding.js";
import { $, html } from "./dom.js";
import { renderGroupPage } from "./groups.js";
import { renderMain } from "./lists.js";
import { renderRemovedLists, renderServers, renderSettings } from "./settings.js";
import { S, savePrefs, syncState } from "./state.js";

export function render() {
  if (S.drag || S.reorder) return; // after the gesture
  S.rendering = true;
  const sc = $("#scroll");
  const top = sc && sc.dataset.view === S.view ? sc.scrollTop : 0;
  const app = $("#app");
  if (!S.loaded)
    app.innerHTML = html`<header class="top"><h1>Listikka</h1></header><div class="loading">Loading…</div>`;
  else if (S.view === "main") app.innerHTML = renderMain();
  else if (S.view === "settings") app.innerHTML = renderSettings();
  else if (S.view === "servers") app.innerHTML = renderServers();
  else if (S.view === "group")
    app.innerHTML = renderGroupPage() || renderSettings(); // the group was left
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

/**
 * The header's dot: filled when a server or group has a problem, hollow while changes wait for one. Nothing for
 * servers and groups that are paused: that's a choice made on this device, not something to fix.
 */
export function syncDot() {
  const st = syncState();
  if (st.failing) return html`<span class="dot bad" aria-hidden="true"></span>`;
  return st.waiting ? html`<span class="dot" aria-hidden="true"></span>` : "";
}
