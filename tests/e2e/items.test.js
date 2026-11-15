// Items: adding, ticking, editing, removing with Undo, adding back from suggestions, drafts, keeping it all, and the on-screen keyboard.
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
    assert.deepEqual(sugg, ["Eggs10Add back"]);
    await P.click("#sugg .sg");
    assert.equal(await P.textContent("#sheet-title"), "Add back");
    assert.equal(await P.inputValue("#f-q"), "10");
    await P.click('[data-act="addback-confirm"]');
    await P.press("#add-input", "Escape");
    assert.deepEqual(await shown(P, lidl), ["Oat milk 2 l", "Eggs 10"]);
  });

  it("Add, shown once something is typed, adds it and keeps the field open", async () => {
    await P.click('section[data-list=""] .add-row');
    assert.equal(await P.isVisible(".add-btn"), false);
    await P.fill("#add-input", "Tape");
    await P.click(".add-btn");
    assert.deepEqual(await shown(P, ""), ["Batteries", "Bread", "Tape"]);
    assert.equal(await P.evaluate(() => document.activeElement?.id), "add-input");
    assert.equal(await P.isVisible(".add-btn"), false);
  });

  it("leaving the field, as Done above the keyboard does, adds what was typed", async () => {
    await P.fill("#add-input", "Glue");
    await P.evaluate(() => document.activeElement.blur());
    await P.waitForSelector("#add-input", { state: "detached" });
    assert.deepEqual(await shown(P, ""), ["Batteries", "Bread", "Tape", "Glue"]);
    assert.equal(await P.$('section[data-list=""] .add-row em'), null);
  });

  it("Escape keeps typed text as a draft, and offers it again", async () => {
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
    assert.deepEqual(await shown(P, ""), ["Batteries", "Bread", "Tape", "Glue"]);
    const milk = (await items(P)).find((i) => i.name === "Oat milk");
    assert.equal(milk.note, "The barista one");
    assert.ok(milk.ts.name > 0 && milk.ts.q > 0);
  });

  it("had no script errors", () => assert.deepEqual(h.errors, []));
});

describe("with the on-screen keyboard", () => {
  let h, P;
  before(async () => {
    h = await startHarness();
    P = await h.device();
    // iOS lays the keyboard over the page: the visual viewport shrinks and the page doesn't
    await P.addInitScript(() => {
      const vv = new EventTarget();
      let kb = 0;
      Object.defineProperties(vv, {
        width: { get: () => window.innerWidth },
        height: { get: () => window.innerHeight - kb },
        offsetTop: { get: () => 0 },
        offsetLeft: { get: () => 0 },
        scale: { get: () => 1 },
      });
      Object.defineProperty(window, "visualViewport", { get: () => vv });
      window.__keyboard = (n) => {
        kb = n;
        vv.dispatchEvent(new Event("resize"));
      };
    });
    await P.reload();
    await ready(P);
  });
  after(() => h.close());

  const KB = 340;
  const above = (sel) => P.$eval(sel, (el, kb) => el.getBoundingClientRect().bottom <= window.innerHeight - kb + 1, KB);

  it("keeps the field being typed in above it while suggestions grow", async () => {
    const lidl = await newList(P, "Lidl");
    const names = Array.from({ length: 12 }, (_, n) => `Thing ${n + 1}`);
    await addItems(P, lidl, ...names);
    for (const n of names.slice(0, 4)) {
      await P.click(`${row(n)} [data-act="edit"]`);
      await P.click('[data-act="sheet-remove"]');
    }
    await P.click(`section[data-list="${lidl}"] .add-row`);
    await P.evaluate((kb) => window.__keyboard(kb), KB);
    await P.fill("#add-input", "Thing");
    assert.equal(await P.$$eval("#sugg .sg", (els) => els.length), 4);
    assert.ok(await above(".add-field"), "the field shows above the keyboard");
    await P.press("#add-input", "Escape");
  });

  it("lifts sheets above it, and shows the field being typed in", async () => {
    await P.click(`${row("Thing 12")} [data-act="edit"]`);
    await P.focus("#f-note");
    await P.evaluate((kb) => window.__keyboard(kb), KB);
    await P.waitForTimeout(300); // the sheet slides in
    assert.ok(await above(".sheet"), "the sheet ends above the keyboard");
    await P.waitForFunction(
      (kb) => document.querySelector("#f-note").getBoundingClientRect().bottom <= window.innerHeight - kb + 1,
      KB,
    );
    await P.evaluate(() => window.__keyboard(0));
    await P.click('[data-act="sheet-done"]');
  });

  it("had no script errors", () => assert.deepEqual(h.errors, []));
});

describe("adding a name that's already in the list", () => {
  let h, P, lidl, prisma;
  const label = () => P.textContent(".add-btn");
  before(async () => {
    h = await startHarness();
    P = await h.device();
    lidl = await newList(P, "Lidl");
    prisma = await newList(P, "Prisma");
    await addItems(P, lidl, "Coffee", "Milk", "Bread");
    await addItems(P, prisma, "Bananas");
    await P.click(`${row("Coffee")} [data-act="edit"]`);
    await P.click('[data-act="sheet-remove"]');
    await P.click(`${row("Bread")} [data-act="tick"]`);
  });
  after(() => h.close());

  it("the removed one's whole name: Add back brings it back instead of a second one", async () => {
    await P.click(`section[data-list="${lidl}"] .add-row`);
    await P.fill("#add-input", "Co");
    assert.equal(await label(), "Add");
    assert.equal(await P.textContent("#sugg .sg .sg-act"), "Add back");
    await P.fill("#add-input", "coffee");
    assert.equal(await label(), "Add back");
    await P.press("#add-input", "Enter");
    assert.deepEqual(await shown(P, lidl), ["Coffee", "Milk", "Bread"], "back in its place");
    assert.equal(await P.$$eval(`section[data-list="${lidl}"] li.item`, (els) => els.length), 3);
  });

  it("a ticked one's name: Untick", async () => {
    await P.fill("#add-input", "Bread");
    assert.equal(await label(), "Untick");
    assert.ok(await P.$eval(row("Bread"), (li) => li.classList.contains("match")), "the row is shown");
    await P.press("#add-input", "Enter");
    assert.equal(await P.$eval(row("Bread"), (li) => li.classList.contains("done")), false);
  });

  it("an unticked one's name: the row is shown, and Add again adds a second one", async () => {
    await P.fill("#add-input", "milk");
    assert.equal(await label(), "Add again");
    assert.ok(await P.$eval(row("Milk"), (li) => li.classList.contains("match")));
    await P.click(".add-btn");
    assert.deepEqual(await shown(P, lidl), ["Coffee", "Milk", "Bread", "milk"]);
    assert.equal(await P.$("li.item.match"), null);
  });

  it("a name only on another list: Add, so it can be on both", async () => {
    await P.fill("#add-input", "Bananas");
    assert.equal(await label(), "Add");
    await P.press("#add-input", "Enter");
    await P.press("#add-input", "Escape");
    assert.deepEqual(await shown(P, prisma), ["Bananas"]);
    assert.ok((await shown(P, lidl)).includes("Bananas"));
  });

  it("had no script errors", () => assert.deepEqual(h.errors, []));
});
