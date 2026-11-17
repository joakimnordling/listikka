// Noticing a newer version, as in Lokki: each build publishes version.json (scripts/build-site.js), and the app
// compares its commit with its own. A home-screen app on iOS can stay paused for days without reloading, so it checks
// on start and when it comes back to the front, at most every 15 minutes, and offers a banner to update.

import { BUILD } from "../core/version.js";
import { html } from "./dom.js";

const EVERY_MS = 15 * 60 * 1000;
const DISMISSED = "listikka-update-dismissed";
let lastCheck = 0;

/** Whether this app can check: a build, served over http(s). */
const canCheck = () => !!BUILD.commit && location.protocol.startsWith("http");

const dismissed = () => {
  try {
    return localStorage.getItem(DISMISSED);
  } catch {
    return null;
  }
};
function dismiss(commit) {
  try {
    localStorage.setItem(DISMISSED, commit);
  } catch {
    /* not kept in this browser */
  }
}

/** The deployed build's info, or null when it can't be fetched. */
async function deployed() {
  try {
    const res = await fetch(new URL("version.json", document.baseURI), { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch (_e) {
    return null;
  }
}

/**
 * Check for a newer version. `asked`: from Settings, so check now, show the banner even if dismissed before, and say
 * so with `say(text)` when there's nothing new or no answer. Returns "new", "same" or "unknown".
 */
export async function checkForUpdate({ asked = false, say = () => {} } = {}) {
  if (!canCheck()) {
    if (asked) say("This copy of Listikka can't check for updates.");
    return "unknown";
  }
  const now = Date.now();
  if (!asked && now - lastCheck < EVERY_MS) return "unknown";
  lastCheck = now;
  const info = await deployed();
  if (!info?.commit) {
    if (asked) say("Couldn't check for updates. Are you online?");
    return "unknown";
  }
  if (info.commit === BUILD.commit) {
    if (asked) say("Listikka is up to date.");
    return "same";
  }
  if (asked || dismissed() !== info.commit) banner(info);
  return "new";
}

/** Get the new version: let the service worker fetch it, then reload the page. */
export async function update() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch (_e) {}
  location.reload();
}

function banner(info) {
  document.querySelector(".update")?.remove();
  const b = document.createElement("div");
  b.className = "update";
  b.setAttribute("role", "status");
  b.innerHTML = html`<span>A new version of Listikka is available.</span><button class="go">Update</button><button class="x" aria-label="Dismiss">✕</button>`;
  b.querySelector(".go").onclick = update;
  b.querySelector(".x").onclick = () => {
    dismiss(info.commit); // until a newer one comes out
    b.remove();
  };
  document.body.appendChild(b);
}

/** Check now, and whenever the app comes back to the front. */
export function watchForUpdates() {
  if (!canCheck()) return;
  checkForUpdate();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
}
