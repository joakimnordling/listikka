// Items: adding, ticking, editing, removing with Undo, adding back from suggestions, drafts, and keeping it all.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { addItems, items, newList, ready, row, shown, startHarness, toastText } from "./harness.js";

describe("items", () => {
  let h, P, lidl;
  before(async () => {
    h = await startHarness();
    P = await h.device();
  });
  after(() => h.close());

  it("adds items at the end; Enter keeps the field open for the next one", async () => {
    lidl = await newList(P, "Lidl");
    await addItems(P, lidl, "Milk", "Eggs", "Bread");
    assert.deepEqual(await shown(P, lidl), ["Milk", "Eggs", "Bread"]);
    assert.equal(await P.textContent(`section[data-list="${lidl}"] .count`), "3");
  });

  it("ticks and unticks in place, and the count follows", async () => {
    await P.click(`${row("Eggs")} [data-act="tick"]`);
    assert.ok(await P.$eval(row("Eggs"), (li) => li.classList.contains("done")));
    assert.deepEqual(await shown(P, lidl), ["Milk", "Eggs", "Bread"]);
    assert.equal(await P.textContent(`section[data-list="${lidl}"] .count`), "2");
    await P.click(`${row("Eggs")} [data-act="tick"]`);
    assert.ok(!(await P.$eval(row("Eggs"), (li) => li.classList.contains("done"))));
  });

  it("edits the name, quantity and note in the item sheet", async () => {
    await P.click(`${row("Milk")} [data-act="edit"]`);
    await P.fill("#f-name", "Oat milk");
    await P.fill("#f-q", "2 l");
    await P.fill("#f-note", "The barista one");
    await P.click('[data-act="sheet-done"]');
    assert.deepEqual(await shown(P, lidl), ["Oat milk 2 l", "Eggs", "Bread"]);
    assert.equal(await P.textContent(`${row("Oat milk")} .note`), "The barista one");
  });

  it("moves an item to another list from the sheet, to the end there", async () => {
    await addItems(P, "", "Batteries");
    await P.click(`${row("Bread")} [data-act="edit"]`);
    await P.selectOption("#f-list", "");
    await P.click('[data-act="sheet-done"]');
    assert.deepEqual(await shown(P, ""), ["Batteries", "Bread"]);
    assert.deepEqual(await shown(P, lidl), ["Oat milk 2 l", "Eggs"]);
  });

  it("removes an item from the sheet, and Undo brings it back", async () => {
    await P.click(`${row("Eggs")} [data-act="edit"]`);
    await P.click('[data-act="sheet-remove"]');
    assert.equal(await toastText(P, /Removed/), "Removed Eggs");
    assert.deepEqual(await shown(P, lidl), ["Oat milk 2 l"]);
    await P.click('[data-act="undo"]');
    await P.waitForSelector(row("Eggs"));
    assert.deepEqual(await shown(P, lidl), ["Oat milk 2 l", "Eggs"]);
  });

  it("suggests removed items while typing, and adds one back after checking it", async () => {
    await P.click(`${row("Eggs")} [data-act="edit"]`);
    await P.fill("#f-q", "10");
    await P.click('[data-act="sheet-remove"]');
    await P.click(`section[data-list="${lidl}"] .add-row`);
    await P.fill("#add-input", "eg");
    const sugg = await P.$$eval("#sugg .sg", (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(sugg, ["Add “eg”", "Eggs10"]);
    await P.click('#sugg .sg[data-sg]:not([data-sg=""])');
    assert.equal(await P.textContent("#sheet-title"), "Add back");
    assert.equal(await P.inputValue("#f-q"), "10");
    await P.click('[data-act="addback-confirm"]');
    await P.press("#add-input", "Escape");
    assert.deepEqual(await shown(P, lidl), ["Oat milk 2 l", "Eggs 10"]);
  });

  it("keeps typed text as a draft when the field closes, and offers it again", async () => {
    await P.click(`section[data-list="${lidl}"] .add-row`);
    await P.fill("#add-input", "Chee");
    await P.press("#add-input", "Escape");
    assert.equal(await P.textContent(`section[data-list="${lidl}"] .add-row em`), "Chee");
    await P.click(`section[data-list="${lidl}"] .add-row`);
    assert.equal(await P.inputValue("#add-input"), "Chee");
    await P.fill("#add-input", "");
    await P.press("#add-input", "Escape");
    assert.equal(await P.$(`section[data-list="${lidl}"] .add-row em`), null);
  });

  it("keeps everything on the device", async () => {
    await P.reload();
    await ready(P);
    assert.deepEqual(await shown(P, lidl), ["Oat milk 2 l", "Eggs 10"]);
    assert.deepEqual(await shown(P, ""), ["Batteries", "Bread"]);
    const milk = (await items(P)).find((i) => i.name === "Oat milk");
    assert.equal(milk.note, "The barista one");
    assert.ok(milk.ts.name > 0 && milk.ts.q > 0);
  });

  it("had no script errors", () => assert.deepEqual(h.errors, []));
});
