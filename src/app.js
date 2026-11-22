/* Listikka: starting the app. The screens are in src/ui: state.js holds the data and what the screen is doing,
   render.js draws the current view, and each other module draws its part and registers what its taps do
   (registry.js). */
import { $ } from "./ui/dom.js";
import { watchInstall } from "./ui/install.js";
import { keepInView, watchKeyboard } from "./ui/keyboard.js";
import { render } from "./ui/render.js";
import { renderSheet } from "./ui/sheets.js";
import { applyTheme, clock, groups, S, store, sync } from "./ui/state.js";
import { watchForUpdates } from "./ui/update.js";
import "./ui/adding.js";
import "./ui/backup.js";
import "./ui/lists.js";
import "./ui/menus.js";
import "./ui/settings.js";
import "./ui/sync-setup.js";
import "./ui/groups.js";
import "./ui/toast.js";
import "./ui/gestures.js";
import "./ui/refresh.js";

// The field being typed in stays above the keyboard, in the list or in a sheet.
const typingIn = () => {
  const a = document.activeElement;
  return a?.id === "add-input" ? $(".add-field") : a?.closest(".sheet") && a.matches("input, select") ? a : null;
};
watchKeyboard(() => keepInView(typingIn()));
document.addEventListener("focusin", () => setTimeout(() => keepInView(typingIn()), 0));

watchInstall(() => {
  if (S.view === "main") render();
});

store.onChange(() => {
  for (const r of [...store.lists(), ...store.items()]) clock.observeRecord(r);
  render();
  if (S.sheet && (S.sheet.type === "server" || S.sheet.type === "appmenu")) renderSheet();
});
const redraw = () => {
  if (S.view !== "removed") render();
  if (S.sheet?.type === "server" || S.sheet?.type === "add-device") renderSheet();
};
sync.onChange(redraw);
groups.onChange(redraw);

applyTheme();
render();
await store.load();
for (const r of [...store.lists(), ...store.items()]) clock.observeRecord(r);
await sync.load();
await groups.load();
S.loaded = true;
render();
sync.start();
groups.start();
watchForUpdates();
