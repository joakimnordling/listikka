// Backing up, restoring a backup, and clearing this device's data.

import { backupText, parseBackup, planRestore } from "../core/backup.js";
import { zipOne } from "../core/zip.js";
import { clearCopy, clearEverything } from "../data/clear.js";
import { $, html } from "./dom.js";
import { fileStamp, readText, saveFile } from "./files.js";
import { svg } from "./icons.js";
import { onActs, sheetBodies } from "./registry.js";
import { closeSheet, openSheet } from "./sheets.js";
import { S, save, store, sync } from "./state.js";
import { toast } from "./toast.js";

export const count = (n, one) => (n ? `${n} ${n === 1 ? one : `${one}s`}` : "");

// A .zip holding the .jsonl backup (src/core/backup.js); without compression in the browser, the .jsonl as .txt.
async function backUp() {
  const day = fileStamp();
  const text = backupText([...store.lists(), ...store.items()]);
  try {
    const ok =
      typeof CompressionStream === "function"
        ? await saveFile(
            `listikka-backup-${day}.zip`,
            await zipOne(`listikka-backup-${day}.jsonl`, new TextEncoder().encode(text)),
          )
        : await saveFile(`listikka-backup-${day}.txt`, text);
    if (ok) toast("Backup saved");
  } catch (e) {
    toast(`The backup didn't finish: ${e?.message || "unknown error"}`);
  }
}

async function restoreFrom(file) {
  if (!file) return;
  const cant = (body) => openSheet({ type: "notice", title: "Can't restore", body });
  let text;
  try {
    text = await readText(file);
  } catch (e) {
    return cant(
      e?.message === "no-unzip"
        ? "This browser can't open .zip files. Unpack the backup and choose the .jsonl file inside."
        : "This file couldn't be read. It may be damaged or incomplete. Nothing was restored.",
    );
  }
  const b = parseBackup(text);
  if (b.error) return cant(b.error);
  openSheet({ type: "restore", header: b.header, plan: planRestore(b.records, (k, id) => store.get(k, id)) });
}

onActs({
  backup: () => {
    backUp();
  },
  "restore-backup": () => {
    $("#restore-file").click();
  },
  "restore-confirm": () => {
    const records = S.sheet.plan.records;
    closeSheet();
    save(records).then(() => toast("Backup restored"));
  },
  clear: () => {
    openSheet({ type: "clear" });
  },
  "clear-backup": () => {
    closeSheet();
    backUp();
  },
  "clear-copy": () => {
    const n = sync.servers.length;
    openSheet({
      type: "confirm",
      run: () => clearCopy(store.db, sync.servers),
      title: "Clear and download again",
      body: `Remove this device's copy of your lists, and download it again from ${n > 1 ? "your servers" : "your server"}? This can't be undone.`,
      yes: "Clear and download again",
      icon: "refresh",
    });
  },
  "clear-all": () => {
    const synced = sync.status().setUp && sync.servers.length;
    openSheet({
      type: "confirm",
      run: () => clearEverything(store.db),
      title: "Clear everything",
      body: synced
        ? "Remove your lists, the sync setup and this device's settings? This can't be undone."
        : "Remove your lists from this device for good? They aren't saved anywhere else. This can't be undone.",
      yes: "Clear everything",
    });
  },
});

sheetBodies({
  restore: () => {
    const p = S.sheet.plan;
    const at = new Date(S.sheet.header.exported);
    const when = Number.isNaN(+at)
      ? ""
      : `Made ${at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. `;
    const adds = [count(p.added.list, "list"), count(p.added.item, "item")].filter(Boolean).join(" and ");
    const changes = [count(p.changed.list, "list"), count(p.changed.item, "item")].filter(Boolean).join(" and ");
    const what = [adds && `adds ${adds}`, changes && `updates ${changes}`].filter(Boolean).join(", and ");
    return html`<h2 id="sheet-title">Restore from backup</h2>
        <p>${when}The backup has ${count(p.has.list, "list") || "no lists"} and ${count(p.has.item, "item") || "no items"}.</p>
        <p id="restore-plan">${what ? `Restoring ${what}. Nothing changed here since the backup is overwritten.` : "Nothing to restore: Listikka already has everything in this backup."}</p>
        ${what ? html`<button class="primary" data-act="restore-confirm">Restore</button><button class="quiet" data-act="close-sheet">Cancel</button>` : html`<button class="primary" data-act="close-sheet">Close</button>`}`;
  },
  clear: () => {
    const st = sync.status();
    const synced = st.setUp && st.servers.length;
    const lost = synced ? st.onlyHere : 0;
    return synced
      ? html`<h2 id="sheet-title">Clear data</h2>
        <p>This removes data from this device only. Your servers keep your lists.</p>
        ${lost ? html`<p class="err">${lost === 1 ? "1 change hasn't" : `${lost} changes haven't`} reached any server yet and would be lost. Sync first, or back up.</p>` : ""}
        <div class="menu"><button data-act="clear-copy">${svg("refresh")}Clear and download again</button></div>
        <p>Removes this device's copy of your lists and downloads it again. Your sync setup and settings stay.</p>
        <button class="danger" data-act="clear-all">${svg("trash", 18)}Clear everything</button>
        <p>Also removes the sync setup and this device's settings. To sync again, you'll need each server's URL and token, and your passphrase.</p>
        <button class="primary" data-act="close-sheet">Cancel</button>`
      : html`<h2 id="sheet-title">Clear data</h2>
        <p>Your lists are saved only on this device. Clearing removes them for good, unless you have a backup.</p>
        <div class="menu"><button data-act="clear-backup">${svg("download")}Back up first</button></div>
        <button class="danger" data-act="clear-all">${svg("trash", 18)}Clear everything</button>
        <p>Removes your lists and this device's settings.</p>
        <button class="primary" data-act="close-sheet">Cancel</button>`;
  },
});

document.addEventListener("change", (e) => {
  if (e.target.id !== "restore-file") return;
  restoreFrom(e.target.files[0]);
  e.target.value = "";
});
