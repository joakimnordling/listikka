// Sharing groups in Settings: their rows, a group's page, and the sheets to make a group, join one and add a device.

import { encode } from "uqr";
import { CodeError, decodeCode, encodeCode, joinLink, readJoin, showCode } from "../groups/code.js";
import { groupKeys, newGroupKey } from "../groups/keys.js";
import { groupName, groupPicture } from "../groups/look.js";
import { $, html, raw } from "./dom.js";
import { svg } from "./icons.js";
import { onActs, sheetBodies } from "./registry.js";
import { render } from "./render.js";
import { canScan, scanQr } from "./scan.js";
import { ago } from "./settings.js";
import { closeSheet, openSheet, renderSheet } from "./sheets.js";
import { groups, S } from "./state.js";
import { toast } from "./toast.js";

const picture = (look, size) => raw(groupPicture(look, size));
const statusOf = (bit) => groups.status().groups.find((g) => g.bit === bit) ?? null;

/** A group's line in Settings and on its page. */
function groupLine(g) {
  if (g.paused) return html`<span>Paused on this device</span>`;
  if (groups.running) return html`<span>Syncing…</span>`;
  if (!g.last) return html`<span>Not synced yet</span>`;
  if (!g.last.ok) return html`<span class="bad">${g.last.error || "Sync failed"}</span>`;
  return html`<span>Synced ${ago(g.last.at)}${g.lacks ? ` · ${g.lacks} waiting` : ""}</span>`;
}

export function groupRows() {
  return groups
    .status()
    .groups.map(
      (g) =>
        html`<button class="srow" data-act="group" data-bit="${g.bit}">${picture(g.look, 36)}<span class="meta"><b>${g.name}</b>${groupLine(g)}</span>${svg("chevRight", 18)}</button>`,
    );
}

/** How a relay answered this device last. */
function relayLine(r) {
  if (!r.read) return html`<span>Not tried yet</span>`;
  if (!r.read.ok) return html`<span class="bad">Not answering: ${r.read.message}</span>`;
  if (r.wrote && !r.wrote.ok) return html`<span class="bad">Refused your last change: ${r.wrote.message}</span>`;
  return html`<span>Answering${r.wrote ? " · took your last change" : ""} · ${ago(r.read.at)}</span>`;
}

export function renderGroupPage() {
  const g = statusOf(S.group);
  if (!g) {
    S.view = "settings";
    return "";
  }
  return html`<header class="top sub"><button class="icon-btn" data-act="to-settings" aria-label="Back to Settings">${svg("back", 22)}</button><h1>${g.name}</h1></header>
    <div class="scroll" id="scroll"><div class="settings">
      <div class="group-head">${picture(g.look, 64)}<span class="meta"><b>${g.name}</b>${groupLine(g)}</span></div>
      <button class="nav-row" data-act="add-device">${svg("qr")}Add a device</button>
      <h2>Relays</h2>
      ${g.relays.map((r) => html`<div class="srow relay">${svg("relay")}<span class="meta"><b>${r.host}</b>${relayLine(r)}</span></div>`)}
      <h2>Group</h2>
      ${g.paused ? "" : html`<button class="nav-row" data-act="group-sync-now">${svg("refresh")}Sync now</button>`}
      <button class="nav-row" data-act="group-pause"${g.paused ? "" : ' style="border-top: 0"'}>${g.paused ? html`${svg("play")}Resume` : html`${svg("pause")}Pause on this device`}</button>
      <button class="nav-row warn" data-act="group-leave" style="border-top: 0">${svg("leave")}Leave group</button>
      <p class="text dim" style="padding-top: 8px">The devices in a group share all your lists through public Nostr relays, end-to-end encrypted. Anyone with the group's code can read and change them. Changes arrive while Listikka is open.</p>
    </div></div>`;
}

/** A QR code as SVG, dark on light whatever the theme, with the quiet zone scanners need. */
function qrSvg(text) {
  const { data, size } = encode(text, { ecc: "M", border: 0 });
  const q = 4;
  let d = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[y][x]) d += `M${x + q} ${y + q}h1v1h-1z`;
  const n = size + 2 * q;
  return raw(
    `<svg class="qr" viewBox="0 0 ${n} ${n}" role="img" aria-label="QR code to join the group" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`,
  );
}

/** A new key for the New group sheet, with the name and picture it gives. */
async function draw() {
  const key = newGroupKey();
  const { look } = await groupKeys(key);
  return { key, look, name: groupName(look) };
}

/** Join the group with this key, or say why not. */
async function join(key) {
  const already = groups.find(key);
  if (already) {
    S.sheet = { ...S.sheet, error: `This device is already in ${statusOf(already.bit)?.name}.` };
    renderSheet();
    return;
  }
  const g = await groups.add(key);
  closeSheet();
  S.view = "group";
  S.group = g.bit;
  render();
  toast(`Joined ${statusOf(g.bit).name}`);
}

onActs({
  group: ({ b }) => {
    S.view = "group";
    S.group = Number(b.dataset.bit);
    render();
  },
  "new-group": async () => {
    openSheet({ type: "new-group", ...(await draw()) });
  },
  reroll: async () => {
    if (S.sheet?.type !== "new-group") return;
    S.sheet = { ...S.sheet, ...(await draw()) };
    renderSheet();
  },
  "create-group": async () => {
    const g = await groups.add(S.sheet.key);
    S.view = "group";
    S.group = g.bit;
    render();
    // Adding another device is nearly always why a group is made
    openSheet({ type: "add-device", bit: g.bit });
  },
  "add-device": () => {
    openSheet({ type: "add-device", bit: S.group });
  },
  "copy-code": async ({ b }) => {
    try {
      await navigator.clipboard.writeText(encodeCode(groups.keyOf(S.sheet.bit)));
      // said on the button itself, where the finger is
      b.innerHTML = html`${svg("check")}Copied`.text;
      setTimeout(() => {
        if (b.isConnected) b.innerHTML = html`${svg("copy")}Copy code`.text;
      }, 2000);
    } catch {
      toast("Couldn't copy. Select the code and copy it.");
    }
  },
  "join-group": () => {
    openSheet({ type: "join-group" });
  },
  "join-scan": () => {
    scanQr(toast, {
      read: (text) => {
        try {
          return readJoin(text);
        } catch {
          return null;
        }
      },
      hint: () => "That's not a code for a Listikka group.",
      prompt: "Point the camera at the code on the other device: the group's page → Add a device.",
    }).then((key) => {
      if (key && S.sheet?.type === "join-group") join(key);
    });
  },
  "group-sync-now": () => {
    groups.now();
  },
  "group-pause": () => {
    const g = statusOf(S.group);
    groups.setPaused(g.bit, !g.paused).then(() => toast(g.paused ? `Resumed ${g.name}` : `Paused ${g.name}`));
  },
  "group-leave": () => {
    const g = statusOf(S.group);
    openSheet({
      type: "confirm",
      run: () =>
        groups.remove(g.bit).then(() => {
          S.view = "settings";
          render();
          toast(`Left ${g.name}`);
        }),
      title: `Leave ${g.name}?`,
      body: "This device stops syncing with the group. Your lists stay on this device, and on the group's other devices. To join again, you'll need its code.",
      yes: "Leave group",
      icon: "leave",
    });
  },
});

sheetBodies({
  "new-group": () => {
    const { look, name } = S.sheet;
    return html`<h2 id="sheet-title">New group</h2>
      <div class="group-pick">${picture(look, 88)}<b id="new-group-name">${name}</b>
        <button type="button" class="icon-btn" data-act="reroll" aria-label="Another name and picture">${svg("dice", 26)}</button></div>
      <p>The devices in a group share all your lists through public Nostr relays, end-to-end encrypted. The name and picture come from the group's key: tap the dice for another, as they can't be changed later.</p>
      <button class="primary" data-act="create-group">Create group</button>
      <button class="quiet" data-act="close-sheet">Cancel</button>`;
  },
  "add-device": () => {
    const key = groups.keyOf(S.sheet.bit);
    if (!key) return null;
    return html`<h2 id="sheet-title">Add a device</h2>
      <p>On the other device, open Listikka, then Settings → Join a group, and scan this code.</p>
      <div class="qr-box">${qrSvg(joinLink(key))}</div>
      <p>Or type this code there:</p>
      <p class="group-code" id="group-code">${showCode(encodeCode(key))}</p>
      <div class="menu"><button data-act="copy-code">${svg("copy")}Copy code</button></div>
      <p class="dim">Anyone with this code can read and change the group's lists.</p>
      <button class="primary" data-act="close-sheet">Done</button>`;
  },
  "join-group": (err) => {
    const p = S.sheet.preview;
    return html`<h2 id="sheet-title">Join a group</h2>
      <p>On a device already in the group, open the group in Settings, then Add a device.</p>
      ${canScan() ? html`<button type="button" class="scan-btn" data-act="join-scan">${svg("join")}Scan QR code</button><div class="or">or type the code</div>` : ""}
      <form id="join-form" autocomplete="off" style="display: contents">
      <label class="field">Code<input id="f-code" class="group-code-input" value="${S.sheet.code || ""}" autocapitalize="characters" autocorrect="off" spellcheck="false"></label>
      <div class="group-preview" id="join-preview"${p ? "" : " hidden"}>${p ? html`${picture(p.look, 36)}<b>${p.name}</b>` : ""}</div>
      ${err}<button class="primary" type="submit">Join</button></form>
      <button class="quiet" data-act="close-sheet">Cancel</button>`;
  },
});

document.addEventListener("submit", (e) => {
  if (e.target.id !== "join-form") return;
  e.preventDefault();
  const code = $("#f-code").value;
  try {
    join(decodeCode(code));
  } catch (error) {
    S.sheet = { ...S.sheet, code, error: error instanceof CodeError ? error.message : String(error.message) };
    renderSheet();
  }
});

// Once a whole code is typed, the group's name and picture show, so it's clear which group it joins
document.addEventListener("input", async (e) => {
  if (e.target.id !== "f-code") return;
  const code = e.target.value;
  let preview = null;
  try {
    preview = { look: (await groupKeys(decodeCode(code))).look };
    preview.name = groupName(preview.look);
  } catch {}
  if (S.sheet?.type !== "join-group" || $("#f-code")?.value !== code) return;
  S.sheet = { ...S.sheet, code, preview, error: null };
  const box = $("#join-preview");
  box.hidden = !preview;
  box.innerHTML = preview ? html`${picture(preview.look, 36)}<b>${preview.name}</b>`.text : "";
  const err = $(".sheet .err");
  if (err) err.hidden = true;
});
