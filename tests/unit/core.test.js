import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClock } from "../../src/core/clock.js";
import { uuid4 } from "../../src/core/ids.js";
import { matchKey, normName, sameName } from "../../src/core/names.js";
import { edit, isDeleted, lastChanged, newItem, newList, tombstone } from "../../src/core/records.js";

const fixedClock = (start = 1000) => {
  let t = start;
  return createClock(() => t++);
};

describe("names", () => {
  it("compare look-alike names as the same", () => {
    assert.equal(normName("  Garlic  (solo) "), "Garlic (solo)");
    assert.equal(normName("Gar​lic"), "Garlic");
    assert.ok(sameName("GARLIC", " garlic "));
    assert.equal(matchKey("Café"), "café");
  });
});

describe("clock", () => {
  it("never goes backwards and stays above anything it has seen", () => {
    let wall = 5000;
    const c = createClock(() => wall);
    assert.equal(c.now(), 5000);
    assert.equal(c.now(), 5001);
    wall = 4000;
    assert.equal(c.now(), 5002);
    c.observe(9000);
    assert.equal(c.now(), 9001);
    c.observeRecord({ ts: { name: 12000, s: 11000 } });
    assert.equal(c.now(), 12001);
  });
});

describe("ids", () => {
  it("makes UUIDv4s", () => {
    assert.match(uuid4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("records", () => {
  it("give every field its own timestamp, and leave empty fields out", () => {
    const c = fixedClock();
    const i = newItem({ name: "Milk", q: "2 l", note: "", list: "L1", o: "a0" }, c);
    assert.equal(i.kind, "item");
    assert.equal(i.s, "todo");
    assert.deepEqual(Object.keys(i.ts).sort(), ["list", "name", "o", "q", "s"]);
    assert.equal("note" in i, false);
    const l = newList({ name: "Lidl", o: "a0" }, c);
    assert.equal(l.s, "active");
  });

  it("clear a field by leaving it out while keeping its timestamp", () => {
    const c = fixedClock();
    const i = newItem({ name: "Milk", q: "2 l" }, c);
    const j = edit(i, { q: "" }, c);
    assert.equal("q" in j, false);
    assert.ok(j.ts.q > i.ts.q);
    assert.equal(j.name, "Milk");
    assert.equal(j.ts.name, i.ts.name);
  });

  it("don't touch timestamps when nothing changes", () => {
    const c = fixedClock();
    const i = newItem({ name: "Milk" }, c);
    assert.equal(edit(i, { name: "Milk" }, c), i);
  });

  it("refuse to edit fixed fields", () => {
    const c = fixedClock();
    assert.throws(() => edit(newItem({ name: "x" }, c), { id: "y" }, c));
  });

  it("keep only kind, id, d and ts.d when deleted, and can't be edited after", () => {
    const c = fixedClock();
    const i = newItem({ name: "Milk", q: "2 l" }, c);
    const d = tombstone(i, c);
    assert.deepEqual(Object.keys(d).sort(), ["d", "id", "kind", "ts"]);
    assert.deepEqual(Object.keys(d.ts), ["d"]);
    assert.ok(isDeleted(d));
    assert.equal(edit(d, { name: "x" }, c), d);
    assert.equal(lastChanged(d), d.ts.d);
  });
});
