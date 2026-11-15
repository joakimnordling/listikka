// The header's ⋯ menu (all lists at once), the theme, and the toast above an open sheet.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { addItems, newList, ready, row, settings, shown, startHarness, toastText } from "./harness.js";

describe("the header's menu and Settings", () => {
  let h, P, lidl, prisma;
  before(async () => {
    h = await startHarness();
    P = await h.device();
    lidl = await newList(P, "Lidl");
    await addItems(P, lidl, "Milk", "Eggs");
    prisma = await newList(P, "Prisma");
    await addItems(P, prisma, "Soap", "Basil");
    await P.click(`${row("Milk")} [data-act="tick"]`);
    await P.click(`${row("Basil")} [data-act="tick"]`);
  });
  after(() => h.close());

  const appMenu = (act) => P.click('[data-act="app-menu"]').then(() => P.click(`[data-act="${act}"]`));
  const openKeys = () =>
    P.$$eval('section[data-list] [data-act="toggle"]', (els) =>
      els.filter((e) => e.getAttribute("aria-expanded") === "true").map((e) => e.closest("section").dataset.list),
    );

  it("collapses and expands all lists; the entry flips", async () => {
    await appMenu("a-collapse");
    assert.deepEqual(await openKeys(), []);
    await P.click('[data-act="app-menu"]');
    assert.ok(await P.$('[data-act="a-expand"]'));
    await P.click('[data-act="a-expand"]');
    assert.deepEqual(await openKeys(), ["", lidl, prisma]);
  });

  it("hides and shows ticked items in every list at once", async () => {
    await appMenu("a-hide-ticked");
    assert.deepEqual(await shown(P, lidl), ["Eggs"]);
    assert.deepEqual(await shown(P, prisma), ["Soap"]);
    await appMenu("a-show-ticked");
    assert.deepEqual(await shown(P, prisma), ["Soap", "Basil"]);
  });

  it("shows removed items in every list at once", async () => {
    await P.click(`section[data-list="${lidl}"] [data-act="menu"]`);
    await P.click('[data-act="m-remove-ticked"]');
    await appMenu("a-show-removed");
    assert.equal(await P.$$eval(".chip", (c) => c.length), 3);
    assert.deepEqual(await shown(P, lidl), ["Eggs", "Milk"]);
    await P.click('.chip[data-act="exit-removed"]');
    assert.equal(await P.$$eval(".chip", (c) => c.length), 0);
  });

  it("moves the toast above an open sheet, and back when it closes", async () => {
    await P.click(`${row("Soap")} [data-act="edit"]`);
    await P.click('[data-act="sheet-remove"]');
    await toastText(P, /Removed Soap/);
    await P.waitForTimeout(300); // its slide-in
    const low = (await P.locator(".toast").boundingBox()).y;
    await P.click(`section[data-list="${prisma}"] [data-act="menu"]`);
    await P.waitForTimeout(300);
    const sheetTop = (await P.locator(".sheet").boundingBox()).y;
    const toast = await P.locator(".toast").boundingBox();
    assert.ok(toast.y + toast.height <= sheetTop, "the toast sits above the sheet");
    await P.click('.sheet [data-act="close-sheet"]');
    await P.waitForTimeout(300);
    assert.equal((await P.locator(".toast").boundingBox()).y, low);
  });

  it("is Dark (all indigo) by default; a chosen theme stays", async () => {
    assert.equal(await P.evaluate(() => document.documentElement.dataset.appTheme), "indigo");
    await settings(P);
    assert.equal(await P.getAttribute('[data-act="theme"][aria-pressed="true"]', "data-v"), "indigo");
    await P.click('[data-act="theme"][data-v="light"]');
    assert.equal(await P.evaluate(() => document.documentElement.dataset.appTheme), "light");
    await P.click('[data-act="theme"][data-v="auto"]');
    assert.equal(await P.evaluate(() => document.documentElement.dataset.appTheme), undefined);
    await P.reload();
    await ready(P);
    assert.equal(await P.evaluate(() => document.documentElement.dataset.appTheme), undefined);
  });

  it("had no script errors", () => assert.deepEqual(h.errors, []));
});
