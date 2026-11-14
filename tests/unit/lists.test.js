import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClock } from "../../src/core/clock.js";
import {
  activeLists,
  addBack,
  addItem,
  createList,
  deleteList,
  editItem,
  indexLists,
  itemsIn,
  listKeyOf,
  moveItem,
  moveList,
  removedLists,
  removeItem,
  removeList,
  removeTicked,
  restoreList,
  shownItems,
  suggestions,
  tick,
  UNNAMED,
  uncheckedCount,
} from "../../src/core/lists.js";
import { merge } from "../../src/core/merge.js";
import { byOrder, keyAfter, keyAtEnd, keyBefore, keyBetween } from "../../src/core/order.js";

const setup = () => {
  let t = 1000;
  const c = createClock(() => t++);
  const lists = [];
  const items = [];
  const L = (name) => {
    const l = createList(name, lists, c);
    lists.push(l);
    return l;
  };
  const I = (name, key, s) => {
    let i = addItem(name, key, items, indexLists(lists), c);
    if (s === "done") i = tick(i, c);
    if (s === "hidden") i = removeItem(i, c);
    items.push(i);
    return i;
  };
  const replace = (arr, rec) => {
    const k = arr.findIndex((r) => r.id === rec.id);
    arr[k] = rec;
  };
  return { c, lists, items, L, I, replace, byId: () => indexLists(lists) };
};

describe("order", () => {
  it("makes keys between neighbours, and at the ends", () => {
    const k1 = keyBetween(null, null);
    const k2 = keyBetween(k1, null);
    const mid = keyBetween(k1, k2);
    assert.ok(k1 < mid && mid < k2);
    assert.ok(keyBetween(null, k1) < k1);
  });

  it("goes after both when two neighbours share a key", () => {
    const k = keyBetween("a1", "a1");
    assert.ok(k > "a1");
  });

  it("orders equal keys by ID", () => {
    const rows = [
      { id: "b", o: "a1" },
      { id: "a", o: "a1" },
      { id: "c", o: "a0" },
    ];
    assert.deepEqual(
      rows.sort(byOrder).map((r) => r.id),
      ["c", "a", "b"],
    );
  });

  it("anchors a drop to the neighbour it passed", () => {
    const sorted = [
      { id: "milk", o: "a0" },
      { id: "eggs", o: "a1" },
      { id: "bread", o: "a2" },
    ];
    const above = keyBefore(sorted, "eggs");
    assert.ok("a0" < above && above < "a1");
    const below = keyAfter(sorted, "eggs");
    assert.ok("a1" < below && below < "a2");
    assert.ok(keyAtEnd(sorted) > "a2");
    assert.ok(keyBefore(sorted, "milk") < "a0");
  });
});

describe("lists", () => {
  it("keep their order and move without touching the others", () => {
    const { c, lists, L, replace } = setup();
    const lidl = L("Lidl");
    const prisma = L("Prisma");
    const km = L("K-Market");
    assert.deepEqual(
      activeLists(lists).map((l) => l.name),
      ["Lidl", "Prisma", "K-Market"],
    );
    const others = activeLists(lists).filter((l) => l.id !== km.id);
    replace(lists, moveList(km, others, { before: lidl.id }, c));
    assert.deepEqual(
      activeLists(lists).map((l) => l.name),
      ["K-Market", "Lidl", "Prisma"],
    );
    assert.equal(
      lists.find((l) => l.id === prisma.id),
      prisma,
    );
  });

  it("move to Removed lists and back", () => {
    const { c, lists, L, replace } = setup();
    const lidl = L("Lidl");
    replace(lists, removeList(lidl, c));
    assert.equal(activeLists(lists).length, 0);
    assert.equal(removedLists(lists).length, 1);
    replace(lists, restoreList(lists[0], c));
    assert.equal(activeLists(lists)[0].o, lidl.o);
  });

  it("delete permanently with the items they hold, and nothing else", () => {
    const { c, items, L, I } = setup();
    const lidl = L("Lidl");
    const prisma = L("Prisma");
    I("Milk", lidl.id);
    I("Eggs", lidl.id, "hidden");
    I("Soap", prisma.id);
    I("Batteries", UNNAMED);
    const out = deleteList(lidl, items, c);
    assert.equal(out.length, 3);
    assert.ok(out.every((r) => r.d === true));
    assert.deepEqual(new Set(out.map((r) => r.id)), new Set([lidl.id, items[0].id, items[1].id]));
  });

  it("show an item under the unnamed list when its list was deleted meanwhile", () => {
    const { c, lists, items, L, I, replace } = setup();
    const lidl = L("Lidl");
    const deletion = deleteList(lidl, items, c);
    const late = I("Cheese", lidl.id);
    for (const r of deletion) replace(lists, r);
    assert.equal(listKeyOf(late, indexLists(lists)), UNNAMED);
    assert.deepEqual(
      itemsIn(items, UNNAMED, indexLists(lists)).map((i) => i.name),
      ["Cheese"],
    );
  });
});

describe("items", () => {
  it("are added at the end, and two with the same name may share a list", () => {
    const { items, L, I, byId } = setup();
    const lidl = L("Lidl");
    I("Garlic", lidl.id, "done");
    I("Milk", lidl.id);
    I("Garlic", lidl.id);
    assert.deepEqual(
      itemsIn(items, lidl.id, byId()).map((i) => i.name),
      ["Garlic", "Milk", "Garlic"],
    );
  });

  it("tick, untick and stay in place", () => {
    const { c, items, L, I, replace, byId } = setup();
    const lidl = L("Lidl");
    I("Milk", lidl.id);
    const eggs = I("Eggs", lidl.id);
    replace(items, tick(eggs, c));
    const sorted = itemsIn(items, lidl.id, byId());
    assert.deepEqual(
      sorted.map((i) => i.s),
      ["todo", "done"],
    );
    assert.equal(uncheckedCount(sorted), 1);
    replace(items, tick(sorted[1], c));
    assert.equal(uncheckedCount(itemsIn(items, lidl.id, byId())), 2);
  });

  it("are shown by state: ticked in place or hidden, removed only when asked, then grouped", () => {
    const { items, L, I, byId } = setup();
    const lidl = L("Lidl");
    I("A", lidl.id, "done");
    I("B", lidl.id, "hidden");
    I("C", lidl.id);
    const sorted = itemsIn(items, lidl.id, byId());
    assert.deepEqual(
      shownItems(sorted).map((i) => i.name),
      ["A", "C"],
    );
    assert.deepEqual(
      shownItems(sorted, { hideTicked: true }).map((i) => i.name),
      ["C"],
    );
    assert.deepEqual(
      shownItems(sorted, { showRemoved: true }).map((i) => i.name),
      ["C", "A", "B"],
    );
  });

  it("remove all ticked items at once", () => {
    const { c, items, L, I, byId } = setup();
    const lidl = L("Lidl");
    I("A", lidl.id, "done");
    I("B", lidl.id);
    I("C", lidl.id, "done");
    const out = removeTicked(itemsIn(items, lidl.id, byId()), c);
    assert.deepEqual(
      out.map((i) => [i.name, i.s]),
      [
        ["A", "hidden"],
        ["C", "hidden"],
      ],
    );
  });

  it("move to another list, to its end, in one edit with the list", () => {
    const { c, items, L, I, byId } = setup();
    const lidl = L("Lidl");
    const prisma = L("Prisma");
    const milk = I("Milk", lidl.id);
    I("Soap", prisma.id);
    const moved = editItem(milk, { list: prisma.id }, items, byId(), c);
    assert.equal(moved.list, prisma.id);
    assert.equal(moved.ts.list, moved.ts.o);
    assert.ok(moved.o > itemsIn(items, prisma.id, byId())[0].o);
    const toUnnamed = editItem(milk, { list: UNNAMED }, items, byId(), c);
    assert.equal("list" in toUnnamed, false);
  });

  it("keep their place when edited in the same list", () => {
    const { c, items, L, I, byId } = setup();
    const lidl = L("Lidl");
    const milk = I("Milk", lidl.id);
    const e = editItem(milk, { name: "Oat milk", q: "1 l", list: lidl.id }, items, byId(), c);
    assert.equal(e.o, milk.o);
    assert.equal(e.name, "Oat milk");
    assert.equal(editItem(milk, { name: "  " }, items, byId(), c), milk);
  });

  it("are dropped just above or below the item they passed, also among hidden ones", () => {
    const { c, items, L, I, replace, byId } = setup();
    const lidl = L("Lidl");
    I("Milk", lidl.id);
    I("Butter", lidl.id, "hidden");
    const eggs = I("Eggs", lidl.id);
    const bread = I("Bread", lidl.id);
    const sorted = itemsIn(items, lidl.id, byId());
    replace(items, moveItem(bread, lidl.id, sorted, { before: eggs.id }, c));
    assert.deepEqual(
      itemsIn(items, lidl.id, byId()).map((i) => i.name),
      ["Milk", "Butter", "Bread", "Eggs"],
    );
  });

  it("are dragged into another list", () => {
    const { c, items, L, I, replace, byId } = setup();
    const lidl = L("Lidl");
    const prisma = L("Prisma");
    const milk = I("Milk", lidl.id);
    const soap = I("Soap", prisma.id);
    replace(items, moveItem(milk, prisma.id, itemsIn(items, prisma.id, byId()), { before: soap.id }, c));
    assert.deepEqual(
      itemsIn(items, prisma.id, byId()).map((i) => i.name),
      ["Milk", "Soap"],
    );
    assert.equal(itemsIn(items, lidl.id, byId()).length, 0);
  });
});

describe("adding back", () => {
  it("keeps the place in the same list, and everything else", () => {
    const { c, items, L, I, byId } = setup();
    const lidl = L("Lidl");
    const butter = I("Butter", lidl.id);
    I("Milk", lidl.id);
    const removed = removeItem({ ...butter, q: "500 g" }, c);
    const back = addBack(removed, lidl.id, items, byId(), c);
    assert.equal(back.s, "todo");
    assert.equal(back.o, butter.o);
    assert.equal(back.q, "500 g");
  });

  it("moves an item from another list here, to the end, with edits from the sheet", () => {
    const { c, items, L, I, byId } = setup();
    const lidl = L("Lidl");
    const prisma = L("Prisma");
    const jam = I("Jam", prisma.id, "hidden");
    I("Milk", lidl.id);
    const back = addBack(jam, lidl.id, items, byId(), c, { q: "2 jars" });
    assert.equal(back.list, lidl.id);
    assert.equal(back.q, "2 jars");
    assert.ok(back.o > itemsIn(items, lidl.id, byId())[0].o);
  });

  it("loses to a permanent delete made at the same time on another device", () => {
    const { c, items, L, I, byId } = setup();
    const lidl = L("Lidl");
    const jam = I("Jam", lidl.id, "hidden");
    const back = addBack(jam, lidl.id, items, byId(), c);
    const gone = { kind: "item", id: jam.id, d: true, ts: { d: 1 } };
    assert.equal(merge(back, gone).d, true);
  });
});

describe("suggestions", () => {
  it("offer removed items from this list first, then from the others", () => {
    const { items, L, I, byId } = setup();
    const lidl = L("Lidl");
    const prisma = L("Prisma");
    I("Garlic", prisma.id, "hidden");
    I("Garlic (solo)", lidl.id, "hidden");
    I("Gherkins", lidl.id, "hidden");
    I("Garlic bread", lidl.id);
    const s = suggestions("gar", lidl.id, items, byId());
    assert.deepEqual(
      s.map((i) => i.name),
      ["Garlic (solo)", "Garlic"],
    );
  });

  it("show one of several with the same name: this list's, else the most recently removed", () => {
    const { c, items, L, I, replace, byId } = setup();
    const lidl = L("Lidl");
    const prisma = L("Prisma");
    const km = L("K-Market");
    const a = I("Milk", prisma.id, "hidden");
    I("milk ", km.id, "hidden");
    replace(items, removeItem({ ...a, s: "todo" }, c));
    let s = suggestions("milk", lidl.id, items, byId());
    assert.equal(s.length, 1);
    assert.equal(s[0].list, prisma.id);
    I("MILK", lidl.id, "hidden");
    s = suggestions("milk", lidl.id, items, byId());
    assert.equal(s.length, 1);
    assert.equal(s[0].list, lidl.id);
  });

  it("are empty for empty input", () => {
    const { items, byId } = setup();
    assert.deepEqual(suggestions("  ", UNNAMED, items, byId()), []);
  });
});
