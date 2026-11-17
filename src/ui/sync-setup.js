// Setting up sync: adding servers, the passphrase, and each server's sheet.

import { DamagedKeyringError, WrongPassphraseError } from "../../vendor/lokki-sync/crypto.js";
import { OtherAppError } from "../../vendor/lokki-sync/engine.js";
import { OTHER_APP } from "../sync/manager.js";
import { $, $$, esc } from "./dom.js";
import { svg } from "./icons.js";
import { onActs, sheetBodies } from "./registry.js";
import { render } from "./render.js";
import { canScan, scanPairing } from "./scan.js";
import { ago } from "./settings.js";
import { closeSheet, openSheet } from "./sheets.js";
import { S, sync } from "./state.js";
import { toast } from "./toast.js";

function strength(p) {
  let n = 0;
  if (p.length >= 10) n++;
  if (p.length >= 16) n++;
  if (/[^a-zA-Z]/.test(p) || /\s|-/.test(p)) n++;
  if (p.length >= 24) n++;
  return n;
}

function describeError(e) {
  if (e instanceof OtherAppError) return OTHER_APP;
  if (e?.status === 401) return "The server didn't accept the token. Check it, or ask for a new one.";
  if (e?.status === 0) return "Couldn't reach the server. Check the URL and your connection.";
  if (e?.status) return `The server answered with an error (${e.status}).`;
  return e?.message || "Something went wrong.";
}

/** A sheet's form while it works and after: its button and its error change in place, so what was typed stays. */
function setBusy(busy, error = null) {
  S.sheet = { ...S.sheet, busy, error };
  const btn = $(".sheet button[type=submit]");
  if (btn) {
    btn.dataset.idle ??= btn.textContent;
    btn.disabled = busy;
    btn.textContent = busy ? btn.dataset.busy : btn.dataset.idle;
  }
  for (const b of $$(".sheet .scan-btn")) b.disabled = busy;
  const err = $(".sheet .err");
  if (err) {
    err.textContent = error || "";
    err.hidden = !error;
  }
}

async function connect(url, token) {
  S.sheet = { ...S.sheet, url, token };
  const f = { url: $("#f-url"), token: $("#f-token") };
  if (f.url) f.url.value = url;
  if (f.token) f.token.value = token;
  setBusy(true);
  try {
    if (!/^https?:\/\/\S+$/.test(url)) throw new Error("Enter the server's address, starting with https://.");
    if (!token) throw new Error("Enter the token you got for this server.");
    const { keyring } = await sync.inspect(url, token);
    if (sync.vault) {
      await sync.addServer(url, token);
      closeSheet();
      render();
      return;
    }
    openSheet({ type: "passphrase", url, token, keyring });
  } catch (e) {
    setBusy(false, describeError(e));
  }
}

async function setPassphrase() {
  const p1 = $("#p1").value;
  const p2 = $("#p2")?.value;
  const { url, token, keyring } = S.sheet;
  setBusy(true);
  try {
    if (!keyring) {
      if (p1.length < 10) throw new Error("Use at least 10 characters; a few words work well.");
      if (p1 !== p2) throw new Error("The two passphrases differ.");
      await sync.createVault(p1);
    } else {
      await sync.joinVault(keyring, p1);
    }
    await sync.addServer(url, token);
    closeSheet();
    render();
    toast("Sync is on");
  } catch (e) {
    const msg =
      e instanceof WrongPassphraseError
        ? "That passphrase doesn't open this server's lists."
        : e instanceof DamagedKeyringError
          ? "The server's keys look damaged. Ask whoever runs the server."
          : describeError(e);
    setBusy(false, msg);
  }
}

async function changePassphrase() {
  const current = $("#p0").value;
  const next = $("#p1").value;
  setBusy(true);
  try {
    if (next.length < 10) throw new Error("Use at least 10 characters; a few words work well.");
    if (next !== $("#p2").value) throw new Error("The two new passphrases differ.");
    await sync.changePassphrase(current, next);
    closeSheet();
    render();
    toast("Passphrase changed");
  } catch (e) {
    setBusy(false, e instanceof WrongPassphraseError ? "That's not the current passphrase." : describeError(e));
  }
}

onActs({
  "add-server": () => {
    openSheet({ type: "connect" });
  },
  scan: () => {
    scanPairing(toast).then((found) => {
      if (found && S.sheet?.type === "connect") connect(found.url, found.token);
    });
  },
  server: ({ b }) => {
    openSheet({ type: "server", bit: Number(b.dataset.bit) });
  },
  "sync-now": () => {
    sync.now();
  },
  "change-pass": () => {
    openSheet({ type: "change-pass" });
  },
  "server-remove": () => {
    const s = sync.servers.find((x) => x.bit === S.sheet.bit);
    openSheet({
      type: "confirm",
      run: () =>
        sync.removeServer(s.bit).then(() => {
          render();
          toast("Stopped using the server");
        }),
      title: `Stop using ${s.name}?`,
      body: "This device stops syncing with it. Your lists stay on this device, on the server and on your other devices.",
      yes: "Stop using it",
      icon: "x",
    });
  },
});

sheetBodies({
  connect: (err) => {
    return `<h2 id="sheet-title">Add server</h2>
      <p>Sync keeps your lists on several devices through a server you choose. Everything is encrypted on this device with a passphrase only you know; the server can't read it.</p>
      ${canScan() ? `<button type="button" class="scan-btn" data-act="scan"${S.sheet.busy ? " disabled" : ""}>${svg("scan")}Scan QR Code</button><div class="or">or type them</div>` : ""}
      <form id="connect-form" autocomplete="off" style="display: contents">
      <label class="field">URL<input id="f-url" type="url" inputmode="url" placeholder="https://sync.example.com" value="${esc(S.sheet.url || "")}" autocapitalize="off" spellcheck="false"></label>
      <label class="field">Token<input id="f-token" placeholder="lk_…" value="${esc(S.sheet.token || "")}" autocapitalize="off" spellcheck="false"></label>
      ${err}<button class="primary" type="submit" data-busy="Connecting…">Connect</button></form>`;
  },
  passphrase: (err) => {
    let body = "";
    const fresh = !S.sheet.keyring;
    body = fresh
      ? `<h2 id="sheet-title">New passphrase</h2>
      <p>The passphrase encrypts your lists before they leave this device. Keep it somewhere safe, such as a password manager: if you forget it, nobody can open the data on servers. Devices already set up keep working.</p>
      <form id="pass-form" autocomplete="off" style="display: contents">
      <label class="field">Passphrase<input id="p1" type="password" autocomplete="new-password"></label>
      <div class="meter" id="meter" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <label class="field">Again<input id="p2" type="password" autocomplete="new-password"></label>
      ${err}<button class="primary" type="submit" data-busy="Setting up…">Start syncing</button></form>`
      : `<h2 id="sheet-title">Passphrase</h2>
      <p>This server already holds your lists. Enter the passphrase you chose when you set up sync. Lists already on this device are added to them.</p>
      <form id="pass-form" autocomplete="off" style="display: contents">
      <label class="field">Passphrase<input id="p1" type="password" autocomplete="current-password"></label>
      ${err}<button class="primary" type="submit" data-busy="Opening…">Join</button></form>`;
    return body;
  },
  "change-pass": (err) => {
    return `<h2 id="sheet-title">Change passphrase</h2>
      <p>The new passphrase opens your lists on servers from now on. Devices already set up keep working without it.</p>
      <form id="change-form" autocomplete="off" style="display: contents">
      <label class="field">Current<input id="p0" type="password" autocomplete="current-password"></label>
      <label class="field">New<input id="p1" type="password" autocomplete="new-password"></label>
      <div class="meter" id="meter" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <label class="field">Again<input id="p2" type="password" autocomplete="new-password"></label>
      ${err}<button class="primary" type="submit" data-busy="Changing…">Change</button></form>
      <button class="quiet" data-act="close-sheet">Cancel</button>`;
  },
  server: () => {
    let body = "";
    const s = sync.status().servers.find((x) => x.bit === S.sheet.bit);
    if (!s) {
      closeSheet();
      return;
    }
    body = `<h2 id="sheet-title">${esc(s.name)}</h2>
      <p>${esc(s.url)}<br>${s.last ? (s.last.ok ? `Synced ${ago(s.last.at)}.` : esc(s.last.error || "Sync failed.")) : "Not synced yet."}${s.lacks ? ` ${s.lacks} ${s.lacks === 1 ? "change" : "changes"} waiting.` : ""}</p>
      <div class="menu"><button data-act="sync-now">${svg("refresh")}Sync now</button>
      <button class="warn" data-act="server-remove">${svg("x")}Stop using this server</button></div>
      <button class="primary" data-act="close-sheet">Done</button>`;
    return body;
  },
});

document.addEventListener("submit", (e) => {
  const id = e.target.id;
  if (id !== "connect-form" && id !== "pass-form" && id !== "change-form") return;
  e.preventDefault();
  if (id === "connect-form") connect($("#f-url").value.trim(), $("#f-token").value.trim());
  else if (id === "pass-form") setPassphrase();
  else changePassphrase();
});
document.addEventListener("input", (e) => {
  if (e.target.id === "p1" && $("#meter")) {
    const n = strength(e.target.value);
    $$("#meter span").forEach((s, k) => {
      s.classList.toggle("on", k < n);
    });
  }
});
