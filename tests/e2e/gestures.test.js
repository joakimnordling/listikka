// Gestures: swiping right to tick, untick or add back; swiping left to Remove or Delete; holding to move items and lists.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { addItems, holdAndDrag, newList, row, shown, startHarness, swipe, toastText } from "./harness.js";

describe("gestures", () => {
  let h, P, lidl, prisma;
  before(async () => {
    h = await startHarness();
    P = await h.device();
    lidl = await newList(P, "Lidl");
    await addItems(P, lidl, "Milk", "Eggs", "Bread");
    prisma = await newList(P, "Prisma");
    await addItems(P, prisma, "Soap");
  });
  after(() => h.close());

  const done = (name) => P.$eval(row(name), (li) => li.classList.contains("done"));

  it("a short swipe right does nothing; a longer one ticks, and again unticks", async () => {
    await swipe(P, row("Milk"), 40);
    assert.equal(await done("Milk"), false);
    await swipe(P, row("Milk"), 120);
    assert.equal(await done("Milk"), true);
    await swipe(P, row("Milk"), 120);
    assert.equal(await done("Milk"), false);
  });

  it("swiping left reveals Remove, with Undo in the toast", async () => {
    await swipe(P, row("Bread"), -120);
    await P.click(`${row("Bread")} [data-act="remove-item"]`);
    assert.equal(await toastText(P, /Removed/), "Removed Bread");
    assert.deepEqual(await shown(P, lidl), ["Milk", "Eggs"]);
  });

  it("removed items swipe right to add back, and left to delete permanently", async () => {
    await P.click(`section[data-list="${lidl}"] [data-act="menu"]`);
    await P.click('[data-act="m-show-removed"]');
    assert.deepEqual(await shown(P, lidl), ["Milk", "Eggs", "Bread"]);
    assert.ok(await P.$(`${row("Bread")} .state-ic`), "a broom marks it as removed");
    await swipe(P, row("Bread"), 120);
    await P.waitForSelector(`${row("Bread")}:not(.removed)`);
    await swipe(P, row("Bread"), -120);
    await P.click(`${row("Bread")} [data-act="remove-item"]`);
    await swipe(P, row("Bread"), -120);
    await P.click(`${row("Bread")} [data-act="delete-item"]`);
    assert.equal(await P.textContent("#sheet-title"), "Delete Bread permanently?");
    await P.click('[data-act="confirm-yes"]');
    await P.waitForSelector(row("Bread"), { state: "detached" });
    await P.click('[data-act="exit-removed"]');
  });

  it("holding an item and dragging it moves it within the list", async () => {
    const milk = await P.locator(row("Milk")).boundingBox();
    const eggs = await P.locator(row("Eggs")).boundingBox();
    await holdAndDrag(P, `${row("Eggs")} .name`, { y: milk.y + 5 });
    assert.deepEqual(await shown(P, lidl), ["Eggs", "Milk"]);
    assert.ok(eggs.y > milk.y);
  });

  it("while held, the row leaves a slot where the item will land", async () => {
    const slotted = () =>
      P.$$eval(`section[data-list="${lidl}"] li.item`, (els) =>
        els.map((li) => (li.classList.contains("dragging") ? "slot" : li.querySelector(".n").textContent)),
      );
    const eggs = await P.locator(`${row("Eggs")} .name`).boundingBox();
    const milk = await P.locator(row("Milk")).boundingBox();
    await P.mouse.move(eggs.x + 10, eggs.y + 10);
    await P.mouse.down();
    await P.waitForSelector("li.item.dragging");
    assert.deepEqual(await slotted(), ["slot", "Milk"]);
    // the row following the finger is outside its list, and has no bullet
    assert.equal(await P.$eval("li.ghost", (g) => getComputedStyle(g).listStyleType), "none");
    // nor can holding text select it, anywhere but in fields
    assert.deepEqual(
      await P.evaluate(() => {
        const field = document.createElement("input");
        document.querySelector("#app").append(field);
        const r = [getComputedStyle(document.querySelector(".lname")).userSelect, getComputedStyle(field).userSelect];
        field.remove();
        return r;
      }),
      ["none", "text"],
    );
    await P.mouse.move(eggs.x + 10, milk.y + milk.height - 5, { steps: 12 });
    assert.deepEqual(await slotted(), ["Milk", "slot"]);
    await P.mouse.up();
    assert.deepEqual(await shown(P, lidl), ["Milk", "Eggs"]);
  });

  it("holding an item and dropping it on another list moves it there", async () => {
    const soap = await P.locator(row("Soap")).boundingBox();
    await holdAndDrag(P, `${row("Milk")} .name`, { y: soap.y + soap.height - 5 });
    assert.deepEqual(await shown(P, prisma), ["Soap", "Milk"]);
    assert.deepEqual(await shown(P, lidl), ["Eggs"]);
  });

  it("dropped on a folded list's title, an item goes to the end of that list", async () => {
    const toggle = `section[data-list="${prisma}"] [data-act="toggle"]`;
    await P.click(toggle);
    const title = await P.locator(`section[data-list="${prisma}"] .list-title`).boundingBox();
    await holdAndDrag(P, `${row("Eggs")} .name`, { y: title.y + 10 });
    await P.click(toggle);
    assert.deepEqual(await shown(P, prisma), ["Soap", "Milk", "Eggs"]);
    assert.deepEqual(await shown(P, lidl), []);
  });

  it("holding a list's title and dragging it reorders the lists", async () => {
    const order = () => P.$$eval("section[data-list] .lname", (els) => els.map((e) => e.textContent));
    assert.deepEqual(await order(), ["Lidl", "Prisma"]);
    // Held, every list folds to its title row, so the target is measured after the lists fold
    const from = await P.locator(`section[data-list="${prisma}"] .lname`).boundingBox();
    await P.mouse.move(from.x + 5, from.y + 5);
    await P.mouse.down();
    await P.waitForSelector(".lists.reordering");
    const lidlTitle = await P.locator(`section[data-list="${lidl}"] .list-title`).boundingBox();
    await P.mouse.move(from.x + 5, lidlTitle.y + 5, { steps: 12 });
    await P.mouse.up();
    assert.deepEqual(await order(), ["Prisma", "Lidl"]);
  });

  it("had no script errors", () => assert.deepEqual(h.errors, []));
});
