// Scanning a server's QR code with the camera (vendor/lokki-sync/pairing.js). The scanner, qr-scanner (MIT), is loaded
// only when needed, from vendor/ next to the app: it's not part of the app's script.
import { parsePairing } from "../../vendor/lokki-sync/pairing.js";
import { LISTIKKA } from "../sync/app.js";

export const canScan = () => !!navigator.mediaDevices?.getUserMedia;

/**
 * Show the camera until a code for Listikka is seen: {url, token}, or null when cancelled or the camera can't be
 * used. `say(text)` shows a short message.
 */
export async function scanPairing(say) {
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
  box.innerHTML = `<video playsinline muted></video><div class="frame"></div>
    <p>Point the camera at the code from <span class="mono">lokki-server token add … --qr --app listikka</span></p>
    <button type="button" class="quiet" id="scan-cancel">Cancel</button>`;
  document.body.appendChild(box);
  return new Promise((resolve) => {
    let hinted = false;
    const scanner = new QrScanner(
      box.querySelector("video"),
      (result) => {
        const found = parsePairing(result.data, LISTIKKA.name);
        if (found) finish(found);
        else if (!hinted) {
          hinted = true;
          say(
            parsePairing(result.data, "lokki")
              ? "That code is for Lokki. Make one with --app listikka."
              : "That's not a code for Listikka's sync.",
          );
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
