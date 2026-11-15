// Putting Listikka on the Home Screen. Chrome and Edge, on Android and on computers, offer installing through the
// beforeinstallprompt event, so Install asks at once there. Safari has no such event, so on an iPhone or iPad the app
// can only say where Add to Home Screen is. Nothing is offered once Listikka runs from the Home Screen.

let deferred = null; // the browser's install prompt, held until Install is tapped

/** Running as an installed app, from the Home Screen or an app window. */
export const installed = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

/** An iPhone or iPad, where Add to Home Screen is in the share sheet; iPads can say they're Macs. */
export const onIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** "prompt" where the browser can install it, "ios" where the steps are shown, or null when there's nothing to offer. */
export function installWay() {
  if (installed()) return null;
  if (deferred) return "prompt";
  return onIos() ? "ios" : null;
}

/** Holds the browser's prompt for Install instead of letting it show its own; onChange runs when the offer changes. */
export function watchInstall(onChange) {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    onChange();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    onChange();
  });
}

/** Shows the browser's install prompt; true when it was accepted. A prompt can be shown only once. */
export async function promptInstall() {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  await e.prompt();
  const choice = await e.userChoice;
  return choice?.outcome === "accepted";
}
