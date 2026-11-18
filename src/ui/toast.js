// The toast at the bottom, with Undo for what can be undone.
import { $, html } from "./dom.js";
import { onActs } from "./registry.js";
import { placeToast } from "./sheets.js";
import { S, undo } from "./state.js";

export function toast(msg, snap) {
  clearTimeout(S.toastTimer);
  S.undoSnap = snap || null;
  $("#toast-host").innerHTML =
    html`<div class="toast" role="status"><span>${msg}</span>${snap ? html`<button data-act="undo">Undo</button>` : ""}</div>`;
  placeToast();
  S.toastTimer = setTimeout(() => {
    $("#toast-host").innerHTML = "";
    S.undoSnap = null;
  }, 5000);
}

onActs({
  undo: () => {
    if (S.undoSnap) {
      const snap = S.undoSnap;
      S.undoSnap = null;
      undo(snap);
    }
    $("#toast-host").innerHTML = "";
  },
});
