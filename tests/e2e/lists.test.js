// Lists: the unnamed list, new lists, renaming, Remove ticked, Show removed items, and removing, adding back and
// deleting lists.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { addItems, items, newList, row, settings, shown, startHarness, toastText } from "./harness.js";

describe("lists", () => {
  let h, P, lidl;
  before(async () => {
    h = await startHarness();
    P = await h.device();
  });
  after(() => h.close());

  const menu = (key, act) =>
    P.click(`section[data-list="${key}"] [data-act="menu"]`).then(() => P.click(`[data-act="${act}"]`));

  it("starts with only the unnamed list, a New list button and a hint about sync", async () => {
    assert.deepEqual(await P.$$eval("section[data-list]", (els) => els.map((e) => e.dataset.list)), [""]);
    assert.ok(await P.$(".new-list"));
    assert.match(await P.textContent(".hint"), /Set up sync in Settings/);
  });

  it("creates a list and opens its add field; the New list button goes once a list exists", async () => {
    lidl = await newList(P, "Lidl");
    assert.equal(await P.$(".new-list"), null);
    await addItems(P, lidl, "Milk", "Eggs", "Bread");
  });

  it("renames a list", async () => {
    await menu(lidl, "m-rename");
    await P.fill("#f-lname", "Lidl Kamppi");
    await P.press("#f-lname", "Enter");
    assert.equal(await P.textContent(`section[data-list="${lidl}"] .lname`), "Lidl Kamppi");
  });

  it("removes all ticked items at once, with Undo", async () => {
    await P.click(`${row("Milk")} [data-act="tick"]`);
    await P.click(`${row("Bread")} [data-act="tick"]`);
    await menu(lidl, "m-remove-ticked");
    assert.equal(await toastText(P, /ticked/), "Removed 2 ticked items");
    assert.deepEqual(await shown(P, lidl), ["Eggs"]);
    await P.click('[data-act="undo"]');
    await P.waitForSelector(row("Milk"));
    assert.deepEqual(await shown(P, lidl), ["Milk", "Eggs", "Bread"]);
  });

  it("hides ticked items with the eye, and says how many are hidden", async () => {
    await P.click(`section[data-list="${lidl}"] [data-act="eye"]`);
    assert.deepEqual(await shown(P, lidl), ["Eggs"]);
    assert.equal(await P.textContent(`section[data-list="${lidl}"] .hidden-note`), "2 ticked items hidden");
    await P.click(`section[data-list="${lidl}"] [data-act="eye"]`);
    assert.deepEqual(await shown(P, lidl), ["Milk", "Eggs", "Bread"]);
  });

  it("shows removed items grouped after the others, with an undo arrow to add one back", async () => {
    await menu(lidl, "m-remove-ticked");
    await addItems(P, lidl, "Cheese");
    await menu(lidl, "m-show-removed");
    assert.deepEqual(await shown(P, lidl), ["Eggs", "Cheese", "Milk", "Bread"]);
    await P.click(`${row("Milk")} [data-act="restore"]`);
    await P.click('[data-act="exit-removed"]');
    assert.deepEqual(await shown(P, lidl), ["Milk", "Eggs", "Cheese"]);
  });

  it("closing a list leaves just its title and count", async () => {
    await P.click(`section[data-list="${lidl}"] [data-act="toggle"]`);
    assert.deepEqual(await shown(P, lidl), []);
    assert.equal(await P.textContent(`section[data-list="${lidl}"] .count`), "3");
    await P.click(`section[data-list="${lidl}"] [data-act="toggle"]`);
  });

  it("removes a list with Undo; it waits in Settings → Removed lists", async () => {
    await menu(lidl, "m-remove-list");
    assert.equal(await toastText(P, /Removed Lidl/), "Removed Lidl Kamppi");
    assert.equal(await P.$(`section[data-list="${lidl}"]`), null);
    await settings(P);
    assert.equal(await P.textContent('[data-act="removed-lists"] .count'), "1");
    await P.click('[data-act="removed-lists"]');
    assert.equal(await P.textContent(".lrow .meta b"), "Lidl Kamppi");
    assert.equal(await P.textContent(".lrow .meta span"), "4 items");
  });

  it("adds a removed list back with its items", async () => {
    await P.click('[data-act="restore-list"]');
    await P.click('[data-act="to-settings"]');
    await P.click('[data-act="back"]');
    assert.deepEqual(await shown(P, lidl), ["Milk", "Eggs", "Cheese"]);
  });

  it("deletes a removed list permanently, with its items", async () => {
    await menu(lidl, "m-remove-list");
    await settings(P);
    await P.click('[data-act="removed-lists"]');
    await P.locator(".lrow").hover();
    const b = await P.locator(".lrow").boundingBox();
    await P.mouse.move(b.x + b.width - 40, b.y + b.height / 2);
    await P.mouse.down();
    await P.mouse.move(b.x + b.width - 160, b.y + b.height / 2 + 2, { steps: 8 });
    await P.mouse.up();
    await P.click('[data-act="delete-list"]');
    assert.equal(await P.textContent("#sheet-title"), "Delete Lidl Kamppi permanently?");
    assert.match(await P.textContent(".sheet p"), /all the items in it are deleted/);
    await P.click('[data-act="confirm-yes"]');
    await P.waitForSelector(".empty");
    assert.match(await P.textContent(".empty"), /No removed lists/);
    assert.deepEqual(
      (await items(P)).map((i) => i.name),
      [],
    );
  });

  it("had no script errors", () => assert.deepEqual(h.errors, []));
});
