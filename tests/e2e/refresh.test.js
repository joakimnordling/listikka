// Pull to refresh: pulled far enough from the top and let go, the app checks for a newer version (and syncs; that
// part is in sync.test.js). Only as a Home Screen app.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { addItems, newList, pullDown, standalone, startHarness, toastText } from "./harness.js";

describe("pull to refresh", () => {
  let h, P;
  const height = () => P.$eval("#ptr", (el) => el.getBoundingClientRect().height);
  before(async () => {
    h = await startHarness();
    P = await h.device({ touch: true });
    await addItems(P, "", "Milk");
  });
  after(() => h.close());

  it("does nothing in a browser tab, where pulling down is the browser's reload", async () => {
    await pullDown(P, 200, async () => assert.equal(await height(), 0));
    await P.waitForTimeout(300);
    assert.equal(await P.$(".toast"), null);
  });

  it("as an app, shows the arrow as it's pulled, and does nothing when let go too soon", async () => {
    await standalone(P);
    await pullDown(P, 100, async () => {
      assert.equal(await height(), 50);
      assert.equal(await P.$eval("#ptr", (el) => el.classList.contains("armed")), false);
    });
    await P.waitForTimeout(300);
    assert.equal(await height(), 0);
    assert.equal(await P.$(".toast"), null);
  });

  it("pulled far enough and let go, checks for a newer version and says so", async () => {
    await pullDown(P, 200, async () => {
      assert.equal(await height(), 100);
      assert.ok(await P.$eval("#ptr", (el) => el.classList.contains("armed")));
    });
    assert.equal(await toastText(P, /up to date/), "Listikka is up to date.");
    await P.waitForFunction(() => document.querySelector("#ptr").getBoundingClientRect().height === 0);
  });

  it("doesn't start when the lists are scrolled down", async () => {
    const l = await newList(P, "Long");
    await addItems(P, l, ...Array.from({ length: 20 }, (_, n) => `Thing ${n}`));
    await P.evaluate(() => document.querySelector("#scroll").scrollTo(0, 300));
    await pullDown(P, 200, async () => assert.equal(await height(), 0));
  });

  it("had no script errors", () => assert.deepEqual(h.errors, []));
});
