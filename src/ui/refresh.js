// Pull to refresh. Pulled down from the top of the lists far enough and let go, Listikka syncs with every server now
// and checks for a newer version, then says how that went. Only when it runs as an app: in a browser tab, pulling
// down is the browser's own reload.
import { $, html } from "./dom.js";
import { svg } from "./icons.js";
import { installed } from "./install.js";
import { groups, S, sync } from "./state.js";
import { toast } from "./toast.js";
import { canCheck, checkForUpdate } from "./update.js";

const ARMED = 70; // px pulled to refresh on letting go
const MOST = 110; // px it can be pulled
const RESTING = 52; // px it stays open while refreshing
let pull = null; // {x, y, by, armed} while a finger pulls

/** The arrow above the lists: as tall as the pull, spinning while refreshing. Drawn by lists.js. */
export const pullIndicator = () =>
  html`<div class="ptr${S.refreshing ? " spinning" : ""}" id="ptr" aria-hidden="true" style="height: ${S.refreshing ? RESTING : 0}px">${svg("refresh", 22)}</div>`;

function show(by) {
  const el = $("#ptr");
  if (!el) return;
  const armed = by >= ARMED;
  if (armed && !pull.armed) navigator.vibrate?.(10);
  pull.by = by;
  pull.armed = armed;
  el.style.height = `${by}px`;
  el.classList.add("pulling");
  el.classList.toggle("armed", armed);
  el.firstElementChild.style.transform = `rotate(${Math.round(by * 3)}deg)`;
}

function close() {
  const el = $("#ptr");
  if (el) {
    el.classList.remove("pulling", "armed");
    el.style.height = "0px";
  }
}

document.addEventListener(
  "touchstart",
  (e) => {
    pull = null;
    if (S.view !== "main" || S.sheet || S.drag || S.reorder || S.refreshing || e.touches.length !== 1) return;
    const sc = $("#scroll");
    if (!sc?.contains(e.target) || sc.scrollTop > 0 || e.target.closest("input, .add") || !installed()) return;
    pull = { x: e.touches[0].clientX, y: e.touches[0].clientY, by: 0, armed: false };
  },
  { passive: true },
);

document.addEventListener(
  "touchmove",
  (e) => {
    if (!pull) return;
    // moving an item, reordering lists or swiping a row sideways isn't pulling
    if (S.drag || S.reorder || S.g?.type === "swipe") {
      pull = null;
      close();
      return;
    }
    const dx = e.touches[0].clientX - pull.x;
    const dy = e.touches[0].clientY - pull.y;
    if (!pull.by && Math.abs(dx) > Math.abs(dy)) {
      pull = null;
      return;
    }
    if (dy <= 0) {
      if (pull.by) show(0);
      return;
    }
    e.preventDefault(); // no page bounce or scroll: the pull shows instead
    show(Math.min(MOST, dy / 2));
  },
  { passive: false },
);

function letGo() {
  if (!pull) return;
  const armed = pull.armed;
  pull = null;
  if (armed) refresh();
  else close();
}
document.addEventListener("touchend", letGo);
document.addEventListener("touchcancel", () => {
  pull = null;
  close();
});

const settle = () =>
  new Promise((ok) => {
    const wait = () => (sync.running || groups.running ? setTimeout(wait, 100) : ok());
    wait();
  });

/** Sync now and check for a newer version, then say how it went. */
export async function refresh() {
  S.refreshing = true;
  const el = $("#ptr");
  if (el) {
    el.classList.remove("pulling", "armed");
    el.classList.add("spinning");
    el.style.height = `${RESTING}px`;
  }
  const said = [];
  try {
    const servers = sync.status().setUp && sync.status().active > 0;
    const inGroups = groups.status().active > 0;
    if (servers || inGroups) {
      await Promise.all([servers && sync.now(), inGroups && groups.now()]);
      await settle();
      const failed = [
        ...sync.status().servers.filter((s) => !s.paused),
        ...groups.status().groups.filter((g) => !g.paused),
      ].find((s) => s.last && !s.last.ok);
      said.push(failed ? failed.last.error || "Sync failed." : "Synced.");
    }
    if (canCheck()) {
      let note = "";
      const r = await checkForUpdate({ asked: true, say: (t) => (note = t) });
      if (r !== "new") said.push(note);
    }
  } finally {
    S.refreshing = false;
    const now = $("#ptr");
    if (now) {
      now.classList.remove("spinning");
      now.style.height = "0px";
    }
    if (said.filter(Boolean).length) toast(said.filter(Boolean).join(" "));
  }
}
