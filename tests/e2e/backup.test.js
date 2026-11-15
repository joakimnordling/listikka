// Backing up, clearing this device's data, and restoring the backup. Clearing a synced device and downloading its
// lists again is in sync.test.js.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { parseBackup } from "../../src/core/backup.js";
import { unzipFirst } from "../../src/core/zip.js";
import { addItems, newList, ready, settings, shown, startHarness, toastText } from "./harness.js";

describe("backup, clear and restore", () => {
  let h, P, lidl, file;
  before(async () => {
    h = await startHarness();
    P = await h.device();
    lidl = await newList(P, "Lidl");
    await addItems(P, lidl, "Milk", "Eggs");
    await addItems(P, "", "Batteries");
  });
  after(() => h.close());

  it("Back up saves a .zip holding the lists and items", async () => {
    await settings(P);
    await P.click('[data-act="theme"][data-v="light"]');
    const [download] = await Promise.all([P.waitForEvent("download"), P.click('[data-act="backup"]')]);
    assert.match(download.suggestedFilename(), /^listikka-backup-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);
    file = join(tmpdir(), download.suggestedFilename());
    await download.saveAs(file);
    assert.equal(await toastText(P, /Backup/), "Backup saved");
    const b = parseBackup(new TextDecoder().decode(await unzipFirst(new Uint8Array(await readFile(file)))));
    assert.equal(b.error, undefined);
    assert.deepEqual(b.records.map((r) => r.name).sort(), ["Batteries", "Eggs", "Lidl", "Milk"]);
  });

  it("Clear data warns that the lists are only on this device, and clears everything after asking", async () => {
    await P.click('[data-act="clear"]');
    assert.match(await P.textContent(".sheet"), /saved only on this device/);
    assert.ok(await P.$('.sheet [data-act="clear-backup"]'), "offers to back up first");
    await P.click('[data-act="clear-all"]');
    assert.match(await P.textContent(".sheet p"), /for good/);
    await Promise.all([P.waitForEvent("load"), P.click('[data-act="confirm-yes"]')]);
    await ready(P);
    assert.equal(await P.$$eval("section[data-list] .lname", (els) => els.length), 0);
    assert.deepEqual(await shown(P, ""), []);
    assert.notEqual(await P.evaluate(() => JSON.parse(localStorage.getItem("listikka-ui") || "{}").theme), "light");
  });

  it("Restore from backup says what it will add, and adds it", async () => {
    await settings(P);
    await P.setInputFiles("#restore-file", file);
    assert.equal(await P.textContent("#sheet-title"), "Restore from backup");
    assert.match(await P.textContent(".sheet"), /The backup has 1 list and 3 items\./);
    assert.equal(
      await P.textContent("#restore-plan"),
      "Restoring adds 1 list and 3 items. Nothing changed here since the backup is overwritten.",
    );
    await P.click('[data-act="restore-confirm"]');
    assert.equal(await toastText(P, /restored/), "Backup restored");
    await P.click('[data-act="back"]');
    assert.deepEqual(await shown(P, lidl), ["Milk", "Eggs"]);
    assert.deepEqual(await shown(P, ""), ["Batteries"]);
  });

  it("restoring it again changes nothing", async () => {
    await settings(P);
    await P.setInputFiles("#restore-file", file);
    assert.match(await P.textContent("#restore-plan"), /^Nothing to restore/);
    assert.equal(await P.$('[data-act="restore-confirm"]'), null);
    await P.click('[data-act="close-sheet"]');
  });

  it("refuses a file that isn't a Listikka backup", async () => {
    const other = join(tmpdir(), "shopping.txt");
    await writeFile(other, "Milk\nEggs\n");
    await P.setInputFiles("#restore-file", other);
    assert.equal(await P.textContent("#sheet-title"), "Can't restore");
    assert.equal(await P.textContent(".sheet p"), "This isn't a Listikka backup.");
    await P.click('[data-act="close-sheet"]');
  });

  it("had no script errors", () => assert.deepEqual(h.errors, []));
});
