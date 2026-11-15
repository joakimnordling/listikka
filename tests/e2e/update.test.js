// Noticing a newer version: the app compares its build with the deployed version.json, as Lokki does.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ready, settings, startHarness, toastText } from "./harness.js";

describe("updates", () => {
  let h, P;
  const newer = { version: "0.1.0", commit: "f".repeat(40), built: "2099-01-01" };
  // Serve version.json as a newer deploy (or failing, with null) until changed again
  const deploy = async (info) => {
    await P.context().unroute("**/version.json");
    await P.context().route("**/version.json", (r) =>
      info ? r.fulfill({ json: info, headers: { "cache-control": "no-store" } }) : r.abort(),
    );
  };
  const restart = async () => {
    await P.reload();
    await ready(P);
  };
  const check = async () => {
    if (!(await P.$('[data-act="check-update"]'))) await settings(P);
    await P.click('[data-act="check-update"]');
  };
  const banner = () => P.$(".update");

  before(async () => {
    h = await startHarness();
    P = await h.device();
  });
  after(() => h.close());

  it("shows the build in Settings, and says it's up to date when the deployed version is this one", async () => {
    await settings(P);
    assert.match(
      await P.textContent("#version"),
      /^Version 0\.1\.0 · [0-9a-f]{7} · built \d{4}-\d\d-\d\d · Source on GitHub$/,
    );
    assert.equal(await banner(), null);
    await check();
    assert.equal(await toastText(P, /up to date/), "Listikka is up to date.");
  });

  it("offers a newer version when the app starts, and remembers a dismissal for that version", async () => {
    await deploy(newer);
    await restart();
    await P.waitForSelector(".update");
    assert.match(await P.textContent(".update"), /A new version of Listikka is available/);
    await P.click(".update .x");
    assert.equal(await banner(), null);
    await restart();
    await P.waitForTimeout(500);
    assert.equal(await banner(), null, "dismissed for this version");
    await check(); // asking shows it anyway
    await P.waitForSelector(".update");
  });

  it("a version newer than the dismissed one is offered again", async () => {
    await P.click(".update .x");
    await deploy({ ...newer, commit: "e".repeat(40) });
    await restart();
    await P.waitForSelector(".update");
  });

  it("Update loads the app again", async () => {
    await Promise.all([P.waitForEvent("load"), P.click(".update .go")]);
    await ready(P);
  });

  it("says so when it can't check", async () => {
    await deploy(null);
    await check();
    assert.match(await toastText(P, /Couldn't check/), /Couldn't check for updates/);
  });

  it("had no script errors", () => assert.deepEqual(h.errors, []));
});
