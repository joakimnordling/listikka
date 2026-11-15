// Setting up sync in Settings, against Lokki's real Python server: a new passphrase on the first device, joining on a
// second, the sync dot, and changing the passphrase. Run scripts/fetch-lokki-server.sh first; needs uv.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startServer } from "../sync/server.js";
import { addItems, row, settings, shown, startHarness, toastText } from "./harness.js";

const PASS = "bilberry pie on sunday";
const NEW = "lingonberry jam on monday";

describe("sync in Settings", () => {
  let h, server, vault, A, B;
  before(async () => {
    h = await startHarness();
    server = await startServer({ cors: [h.base] });
    vault = await server.vault();
    A = await h.device();
    B = await h.device();
  });
  after(async () => {
    await h.close();
    await server.stop();
  });

  async function connect(pg, token) {
    await settings(pg);
    await pg.click('[data-act="add-server"]');
    await pg.fill("#f-url", server.url);
    await pg.fill("#f-token", token);
    await pg.click("#connect-form button[type=submit]");
    await pg.waitForSelector("#p1");
  }
  const errorText = (pg) =>
    pg.waitForSelector(".sheet .err:not([hidden])", { timeout: 60000 }).then((e) => e.textContent());
  const syncNow = async (pg) => {
    await settings(pg);
    await pg.click('.nav-row[data-act="sync-now"]');
    await pg.waitForFunction(() => !window.__listikka.sync.running && window.__listikka.sync.status().unsynced === 0);
    await pg.click('[data-act="back"]');
  };

  it("Settings says sync is off, and the empty list hints at it", async () => {
    assert.match(await A.textContent(".hint"), /Set up sync/);
    await settings(A);
    assert.match(await A.textContent("#sync-summary"), /^Off\./);
    await A.click('[data-act="back"]');
  });

  it("the first device chooses a passphrase; too short or differing ones are refused", async () => {
    await addItems(A, "", "Milk", "Eggs");
    await connect(A, vault.write);
    assert.equal(await A.textContent("#sheet-title"), "New passphrase");
    await A.fill("#p1", "short");
    await A.fill("#p2", "short");
    await A.click("#pass-form button[type=submit]");
    assert.match(await errorText(A), /at least 10 characters/);
    await A.fill("#p1", PASS);
    await A.fill("#p2", `${PASS}!`);
    await A.click("#pass-form button[type=submit]");
    assert.equal(await errorText(A), "The two passphrases differ.");
    await A.fill("#p2", PASS);
    await A.click("#pass-form button[type=submit]");
    assert.equal(await toastText(A, /Sync is on/), "Sync is on");
    await A.waitForSelector(".srow");
    await A.waitForFunction(() => window.__listikka.sync.status().servers[0]?.last?.ok);
    await A.click('[data-act="back"]');
  });

  it("a second device is refused with a wrong passphrase, which stays typed", async () => {
    await addItems(B, "", "Bread");
    await connect(B, vault.write);
    assert.equal(await B.textContent("#sheet-title"), "Passphrase");
    await B.fill("#p1", "not the passphrase");
    await B.click("#pass-form button[type=submit]");
    assert.equal(await errorText(B), "That passphrase doesn't open this server's lists.");
    assert.equal(await B.inputValue("#p1"), "not the passphrase");
  });

  it("with the right one, it joins: both devices end up with all items", async () => {
    await B.fill("#p1", PASS);
    await B.click("#pass-form button[type=submit]");
    await B.waitForSelector(".srow", { timeout: 60000 });
    await B.waitForFunction(() => window.__listikka.sync.status().servers[0]?.last?.ok);
    await B.click('[data-act="back"]');
    await syncNow(A);
    assert.deepEqual((await shown(A, "")).sort(), ["Bread", "Eggs", "Milk"]);
    assert.deepEqual((await shown(B, "")).sort(), ["Bread", "Eggs", "Milk"]);
  });

  it("edits to different fields on the two devices are both kept", async () => {
    await A.click(`${row("Milk")} [data-act="edit"]`);
    await A.fill("#f-name", "Oat milk");
    await A.click('[data-act="sheet-done"]');
    await B.click(`${row("Milk")} [data-act="edit"]`);
    await B.fill("#f-q", "2 l");
    await B.click('[data-act="sheet-done"]');
    await B.click(`${row("Eggs")} [data-act="tick"]`);
    await syncNow(A);
    await syncNow(B);
    await syncNow(A);
    for (const pg of [A, B]) {
      assert.ok((await shown(pg, "")).includes("Oat milk 2 l"));
      assert.ok(await pg.$eval(row("Eggs"), (li) => li.classList.contains("done")));
    }
  });

  it("the header shows a hollow dot while a change waits to sync", async () => {
    await A.evaluate(() => clearTimeout(window.__listikka.sync.timer));
    await A.click(`${row("Bread")} [data-act="tick"]`);
    await A.evaluate(() => clearTimeout(window.__listikka.sync.timer));
    await A.waitForSelector('[data-act="app-menu"] .dot:not(.bad)');
    await syncNow(A);
    await A.waitForSelector('[data-act="app-menu"] .dot', { state: "detached" });
  });

  it("changes the passphrase: a wrong current one is refused; a new device then needs the new one", async () => {
    await settings(A);
    await A.click('[data-act="change-pass"]');
    await A.fill("#p0", "not it");
    await A.fill("#p1", NEW);
    await A.fill("#p2", NEW);
    await A.click("#change-form button[type=submit]");
    assert.equal(await errorText(A), "That's not the current passphrase.");
    assert.equal(await A.inputValue("#p1"), NEW);
    await A.fill("#p0", PASS);
    await A.click("#change-form button[type=submit]");
    assert.equal(await toastText(A, /Passphrase changed/), "Passphrase changed");
    await A.click('.nav-row[data-act="sync-now"]');
    await A.waitForFunction(() => !window.__listikka.sync.running && window.__listikka.sync.status().unsynced === 0);
    await A.click('[data-act="back"]');
    const C = await h.device();
    await connect(C, vault.write);
    await C.fill("#p1", PASS);
    await C.click("#pass-form button[type=submit]");
    assert.equal(await errorText(C), "That passphrase doesn't open this server's lists.");
    await C.fill("#p1", NEW);
    await C.click("#pass-form button[type=submit]");
    await C.waitForSelector(".srow", { timeout: 60000 });
    await C.waitForFunction(() => window.__listikka.sync.status().servers[0]?.last?.ok);
    await C.click('[data-act="back"]');
    assert.ok((await shown(C, "")).includes("Oat milk 2 l"));
  });

  it("Clear data on a synced device warns about unsynced changes, and downloads the lists again", async () => {
    await A.evaluate(() => clearTimeout(window.__listikka.sync.timer));
    await A.click(`${row("Bread")} [data-act="tick"]`);
    await A.evaluate(() => clearTimeout(window.__listikka.sync.timer));
    await settings(A);
    await A.click('[data-act="clear"]');
    assert.match(await A.textContent(".sheet"), /Your servers keep your lists/);
    assert.match(await A.textContent(".sheet .err"), /^1 change hasn't reached any server yet/);
    await A.click('[data-act="close-sheet"]');
    await A.click('[data-act="back"]');
    await syncNow(A);
    await settings(A);
    await A.click('[data-act="clear"]');
    assert.equal(await A.$(".sheet .err"), null);
    await A.click('[data-act="clear-copy"]');
    await Promise.all([A.waitForEvent("load"), A.click('[data-act="confirm-yes"]')]);
    await A.waitForFunction(() => window.__listikka.sync.status().servers[0]?.last?.ok, null, { timeout: 60000 });
    assert.ok((await shown(A, "")).includes("Oat milk 2 l"));
    assert.equal(await A.$eval(row("Bread"), (li) => li.classList.contains("done")), false);
  });

  it("stops using a server, keeping the lists on the device", async () => {
    await settings(B);
    await B.click(".srow");
    await B.click('[data-act="server-remove"]');
    await B.click('[data-act="confirm-yes"]');
    assert.equal(await toastText(B, /Stopped/), "Stopped using the server");
    assert.equal(await B.$(".srow"), null);
    await B.click('[data-act="back"]');
    assert.ok((await shown(B, "")).includes("Oat milk 2 l"));
  });

  it("had no script errors", () => assert.deepEqual(h.errors, []));
});
