// Scanning QR codes with the camera: a sync server's (vendor/lokki-sync/pairing.js) or a group's (src/groups/code.js).
// The scanner, qr-scanner (MIT), is loaded only when needed, from vendor/ next to the app: it's not part of the app's
// script.

import { parsePairing } from "../../vendor/lokki-sync/pairing.js";
import { LISTIKKA } from "../sync/app.js";
import { html } from "./dom.js";

export const canScan = () => !!navigator.mediaDevices?.getUserMedia;

/**
 * Show the camera until a code for Listikka is seen: {url, token}, or null when cancelled or the camera can't be
 * used. `say(text)` shows a short message.
 */
export const scanPairing = (say) =>
  scanQr(say, {
    read: (text) => parsePairing(text, LISTIKKA.name),
    hint: (text) =>
      parsePairing(text, "lokki")
        ? "That code is for Lokki. Make one with --app listikka."
        : "That's not a code for Listikka's sync.",
    prompt: html`Point the camera at the code from <span class="mono">lokki-server token add … --qr --app listikka</span>`,
  });

/**
 * Show the camera until `read(text)` makes something of a code it sees, and return that; null when cancelled or the
 * camera can't be used. The first code it can't read is answered with `hint(text)`, through `say`.
 */
export async function scanQr(say, { read, hint, prompt }) {
  let QrScanner;
  try {
    // not a fixed string, so the build leaves it to the browser
    ({ default: QrScanner } = await import(new URL("vendor/qr-scanner.min.js", document.baseURI).href));
  } catch (_e) {
    say("Couldn't load the scanner. Are you online?");
    return null;
  }
  const box = document.createElement("div");
  box.className = "scan";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Scan QR code");
  box.innerHTML = html`<video playsinline muted></video><div class="frame"></div>
    <p>${prompt}</p>
    <button type="button" class="quiet" id="scan-cancel">Cancel</button>`;
  document.body.appendChild(box);
  return new Promise((resolve) => {
    let hinted = false;
    const scanner = new QrScanner(
      box.querySelector("video"),
      (result) => {
        const found = read(result.data);
        if (found) finish(found);
        else if (!hinted) {
          hinted = true;
          say(hint(result.data));
        }
      },
      { preferredCamera: "environment", returnDetailedScanResult: true, maxScansPerSecond: 10 },
    );
    function finish(found) {
      scanner.destroy();
      box.remove();
      resolve(found);
    }
    // The command line prints its code in light blocks: on a light terminal it comes out inverted
    scanner.setInversionMode("both");
    box.querySelector("#scan-cancel").onclick = () => finish(null);
    scanner.start().catch((e) => {
      say(/denied|NotAllowed/i.test(String(e)) ? "Listikka may not use the camera." : "Couldn't start the camera.");
      finish(null);
    });
  });
}
