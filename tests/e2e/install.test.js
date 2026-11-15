// Putting Listikka on the Home Screen: Install where the browser offers it, the steps on an iPhone, and nothing once
// it runs from the Home Screen or elsewhere.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ready, startHarness } from "./harness.js";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1";
const menuRow = async (pg) => {
  await pg.click('[data-act="app-menu"]');
  const row = await pg.$('.menu [data-act="install"]');
  await pg.click('[data-act="close-sheet"]');
  return !!row;
};

describe("Add to Home Screen", () => {
  let h;
  before(async () => {
    h = await startHarness();
  });
  after(() => h.close());

  it("isn't offered where the browser can't install it", async () => {
    const P = await h.device();
    assert.equal(await P.$(".install-hint"), null);
    assert.equal(await menuRow(P), false);
  });

  it("on an iPhone, the hint and the menu show the steps", async () => {
    const P = await h.device({ userAgent: IPHONE });
    await P.waitForSelector(".install-hint");
    assert.match(await P.textContent(".install-hint"), /Put Listikka on your Home Screen/);
    await P.click('[data-act="install-steps"]');
    assert.equal(await P.textContent("#sheet-title"), "Add to Home Screen");
    assert.equal(await P.$$eval(".steps li", (els) => els.length), 3);
    await P.click('[data-act="close-sheet"]');
    assert.equal(await menuRow(P), true);
  });

  it("dismissed, the hint stays away, and the menu still has the steps", async () => {
    const P = await h.device({ userAgent: IPHONE });
    await P.click('[data-act="install-dismiss"]');
    assert.equal(await P.$(".install-hint"), null);
    await P.reload();
    await ready(P);
    assert.equal(await P.$(".install-hint"), null);
    await P.click('[data-act="app-menu"]');
    await P.click('.menu [data-act="install"]');
    assert.equal(await P.textContent("#sheet-title"), "Add to Home Screen");
    await P.click('[data-act="close-sheet"]');
  });

  it("isn't offered when it already runs from the Home Screen", async () => {
    const P = await h.device({ userAgent: IPHONE });
    await P.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
    await P.reload();
    await ready(P);
    assert.equal(await P.$(".install-hint"), null);
    assert.equal(await menuRow(P), false);
  });

  it("where the browser offers installing, Install shows its prompt", async () => {
    const P = await h.device();
    await P.evaluate(() => {
      const e = new Event("beforeinstallprompt", { cancelable: true });
      e.prompt = async () => {
        window.__prompted = true;
      };
      e.userChoice = Promise.resolve({ outcome: "accepted" });
      window.dispatchEvent(e);
    });
    await P.waitForSelector('.install-hint [data-act="install"]');
    assert.equal(await menuRow(P), true);
    await P.click('.install-hint [data-act="install"]');
    await P.waitForFunction(() => window.__prompted);
    await P.waitForSelector(".install-hint", { state: "detached" });
  });

  it("had no script errors", () => assert.deepEqual(h.errors, []));
});
