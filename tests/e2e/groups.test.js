// Sharing groups in Settings: making a group, adding a device with its code, syncing, pausing, Clear data's warning
// and leaving. Every relay the app asks for is a small relay run by the test (tests/helpers/relay.js).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startRelay } from "../helpers/relay.js";
import { addItems, home, row, settings, shown, startHarness, toastText } from "./harness.js";

describe("sharing groups", () => {
  let relay, h, A, B, name, code;
  before(async () => {
    relay = await startRelay();
    h = await startHarness({ relay: relay.url });
    A = await h.device();
    B = await h.device();
  });
  after(async () => {
    await h.close();
    await relay.close();
  });

  const idle = (pg) =>
    pg.waitForFunction(() => {
      const { groups } = window.__listikka;
      return !groups.running && groups.groups.every((g) => g.last);
    });
  const syncGroups = async (pg) => {
    await idle(pg);
    await pg.evaluate(() => window.__listikka.groups.now());
  };

  it("Settings says sync is off, with New group and Join a group", async () => {
    await settings(A);
    assert.match(await A.textContent("#sync-summary"), /^Off\. .*public Nostr relays/);
    assert.ok(await A.$('[data-act="new-group"]'));
    assert.ok(await A.$('[data-act="join-group"]'));
    assert.match(await A.textContent('[data-act="servers"]'), /Sync servers\s*None/);
    await home(A);
  });

  it("a new group gets a name and picture from its key; the dice draws another", async () => {
    await addItems(A, "", "Milk", "Eggs");
    await settings(A);
    await A.click('[data-act="new-group"]');
    const first = await A.textContent("#new-group-name");
    assert.match(first, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
    assert.ok(await A.$(".sheet svg.group-pic"));
    let other = first;
    for (let n = 0; n < 5 && other === first; n++) {
      await A.click('[data-act="reroll"]');
      await A.waitForFunction((was) => document.querySelector("#new-group-name").textContent !== was, first);
      other = await A.textContent("#new-group-name");
    }
    assert.notEqual(other, first);
    name = other;
    // the first time, this device's name too, guessed from the browser; what's typed stays through the dice
    assert.match(await A.inputValue("#f-me"), /\S/);
    await A.fill("#f-me", "Desk");
    await A.click('[data-act="reroll"]');
    await A.waitForFunction((was) => document.querySelector("#new-group-name").textContent !== was, name);
    name = await A.textContent("#new-group-name");
    assert.equal(await A.inputValue("#f-me"), "Desk");
  });

  it("Create group opens Add a device, with a QR code and the code to type", async () => {
    await A.evaluate(() => {
      window.__drawn = 0;
      new MutationObserver(() => window.__drawn++).observe(document.querySelector("#overlay"), { childList: true });
    });
    await A.click('[data-act="create-group"]');
    await A.waitForSelector('#sheet-title:text-is("Add a device")');
    await idle(A);
    assert.equal(await A.evaluate(() => window.__drawn), 1, "drawn once, not again as the first sync starts and ends");
    assert.ok(await A.$(".sheet svg.qr path"));
    // On a short screen too, as an iPhone's with Safari's bars, the QR code is whole: the sheet scrolls instead
    const size = A.viewportSize();
    await A.setViewportSize({ width: 393, height: 620 });
    const [box, qr] = await A.$eval(".qr-box", (b) =>
      [b.getBoundingClientRect(), b.querySelector("svg").getBoundingClientRect()].map((r) => ({
        w: r.width,
        h: r.height,
      })),
    );
    assert.ok(qr.h <= box.h + 0.5 && box.h >= box.w - 0.5, `QR ${qr.w}×${qr.h} in ${box.w}×${box.h}`);
    await A.setViewportSize(size);
    code = await A.textContent("#group-code");
    assert.match(code, /^([0-9A-Z]{4} ){12}[0-9A-Z]{4}\S$/);
    // Copy code says so on the button
    await A.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: h.base });
    await A.click('[data-act="copy-code"]');
    await A.waitForSelector('[data-act="copy-code"]:has-text("Copied")');
    assert.equal(await A.evaluate(() => navigator.clipboard.readText()), code.replaceAll(" ", ""));
    // and when it can't, the toast shows at once where it stays, above the sheet or over it, without flying there
    await A.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error("not allowed"));
    });
    await A.click('[data-act="copy-code"]');
    await A.waitForSelector(".toast");
    const bottom = () => A.$eval(".toast", (t) => getComputedStyle(t).bottom);
    const first = await bottom();
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await bottom(), first, "it doesn't slide up");
    const [top, end, vh] = await A.$eval(".toast", (t) => [
      t.getBoundingClientRect().top,
      t.getBoundingClientRect().bottom,
      innerHeight,
    ]);
    assert.ok(top >= 0 && end <= vh, `on screen: ${top}–${end} of ${vh}`);
    await A.click('[data-act="close-sheet"]');
    assert.equal(await A.textContent("h1"), name);
    await idle(A);
    assert.match(await A.textContent(".group-head"), /Synced just now/);
    // each relay's answer: here every one of them goes to the test's relay
    assert.deepEqual(await A.$$eval(".relay b", (els) => els.map((e) => e.textContent)), [
      "nos.lol",
      "relay.primal.net",
      "relay.nostr.net",
      "offchain.pub",
      "relay.damus.io (being retired)",
    ]);
    for (const line of await A.$$eval(".relay .meta span", (els) => els.map((e) => e.textContent)))
      assert.match(line, /^Answering · took your last change/);
    await home(A);
  });

  it("a wrong code is refused, before joining anything", async () => {
    await settings(B);
    await B.click('[data-act="join-group"]');
    const wrong = code.slice(0, 10) + (code[10] === "A" ? "B" : "A") + code.slice(11);
    await B.fill("#f-code", wrong);
    await B.click("#join-form button[type=submit]");
    await B.waitForSelector(".sheet .err:not([hidden])");
    assert.match(await B.textContent(".sheet .err"), /check it for a typo/);
    assert.equal(await B.evaluate(() => window.__listikka.groups.groups.length), 0);
  });

  it("the right code, typed loosely, shows the group's name, and joins it", async () => {
    await B.fill("#f-code", code.toLowerCase().replaceAll(" ", "-"));
    await B.waitForSelector("#join-preview:not([hidden])");
    assert.equal(await B.textContent("#join-preview"), name);
    await B.fill("#f-me", "Pocket");
    await B.click("#join-form button[type=submit]");
    assert.equal(await toastText(B, /Joined/), `Joined ${name}`);
    await B.waitForSelector(`h1:text-is("${name}")`);
    await idle(B);
    await home(B);
    assert.deepEqual(await shown(B, ""), ["Milk", "Eggs"]);
  });

  it("changes travel both ways, and the dot shows while one waits", async () => {
    await addItems(B, "", "Bread");
    await B.evaluate(() => clearTimeout(window.__listikka.groups.timer));
    await B.waitForSelector('[data-act="app-menu"] .dot:not(.bad)');
    await syncGroups(B);
    await B.waitForSelector('[data-act="app-menu"] .dot', { state: "detached" });
    await syncGroups(A);
    assert.deepEqual(await shown(A, ""), ["Milk", "Eggs", "Bread"]);
  });

  it("a change arrives on the other device as it's made, while that one is open", async () => {
    await addItems(A, "", "Butter");
    // on the screen, with no sync asked for on B
    await B.waitForSelector(row("Butter"), { timeout: 15000 });
  });

  it("a group's page lists its devices, and whether each has your changes", async () => {
    const devices = (pg) =>
      pg.$$eval(".srow.device .meta", (els) =>
        els.map((e) => [e.querySelector("b").textContent, e.querySelector("span").textContent]),
      );
    await settings(A);
    await A.click('[data-act="group"]');
    await A.waitForFunction(() => document.querySelectorAll(".srow.device").length === 2);
    const rows = await devices(A);
    assert.deepEqual(rows[0], ["Desk", "This device"]);
    assert.equal(rows[1][0], "Pocket");
    assert.match(rows[1][1], /^Online just now · has all your changes$/);
    // renaming this device: the other one sees the new name
    await A.click('[data-act="rename-me"]');
    await A.fill("#f-me", "Desktop");
    await A.click("#me-form button[type=submit]");
    assert.equal(await toastText(A, /Renamed/), "Renamed this device");
    assert.equal((await devices(A))[0][0], "Desktop");
    await home(A);
    await settings(B);
    await B.click('[data-act="group"]');
    await B.waitForFunction(() =>
      [...document.querySelectorAll(".srow.device b")].some((b) => b.textContent === "Desktop"),
    );
    await home(B);
  });

  it("joining a group this device is already in says so", async () => {
    await settings(B);
    assert.match(await B.textContent("#sync-summary"), /^On, in 1 group\./);
    await B.click('[data-act="join-group"]');
    await B.fill("#f-code", code);
    await B.click("#join-form button[type=submit]");
    await B.waitForSelector(".sheet .err:not([hidden])");
    assert.equal(await B.textContent(".sheet .err"), `This device is already in ${name}.`);
    await B.click('.sheet [data-act="close-sheet"]');
  });

  it("pausing keeps changes here, and Clear data warns about them", async () => {
    await B.click('[data-act="group"]');
    await B.click('[data-act="group-pause"]');
    assert.equal(await toastText(B, /Paused/), `Paused ${name}`);
    assert.match(await B.textContent(".group-head"), /Paused on this device/);
    assert.equal(await B.$('[data-act="group-sync-now"]'), null);
    await home(B);
    await addItems(B, "", "Jam");
    assert.equal(await B.$('[data-act="app-menu"] .dot'), null, "a choice made here: no dot");
    await settings(B);
    assert.match(await B.textContent("#sync-summary"), /^Paused on this device\./);
    await B.click('[data-act="clear"]');
    assert.match(await B.textContent(".sheet"), /Your lists stay with your group\./);
    assert.match(await B.textContent(".sheet .err"), /^1 change hasn't reached any group or server yet/);
    await B.click('.sheet [data-act="close-sheet"]');
    await B.click('[data-act="group"]');
    await B.click('[data-act="group-pause"]');
    assert.equal(await toastText(B, /Resumed/), `Resumed ${name}`);
    await idle(B);
    await syncGroups(A);
    await home(B);
    assert.ok((await shown(A, "")).includes("Jam"));
  });

  it("leaving a group keeps the lists on this device", async () => {
    await settings(B);
    await B.click('[data-act="group"]');
    await B.click('[data-act="group-leave"]');
    assert.equal(await B.textContent("#sheet-title"), `Leave ${name}?`);
    await B.click('[data-act="confirm-yes"]');
    assert.equal(await toastText(B, /Left/), `Left ${name}`);
    await B.waitForSelector("#sync-summary");
    assert.equal(await B.$('[data-act="group"]'), null);
    assert.match(await B.textContent("#sync-summary"), /^Off\./);
    await home(B);
    assert.deepEqual(await shown(B, ""), ["Milk", "Eggs", "Bread", "Butter", "Jam"]);
    // it asked the relays to delete its events (NIP-09)
    await new Promise((r) => setTimeout(r, 200));
    assert.ok([...relay.events.values()].some((e) => e.kind === 5));
  });

  it("had no script errors", () => assert.deepEqual(h.errors, []));
});
