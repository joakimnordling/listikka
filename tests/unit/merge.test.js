import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { merge, mergeInto } from "../../src/core/merge.js";

const item = (ts, fields = {}) => ({ kind: "item", id: "i1", ...fields, ts });

describe("merge", () => {
  it("keeps both of two edits to different fields", () => {
    const base = item({ name: 1, q: 1 }, { name: "garlic", q: "1" });
    const mine = { ...base, q: "2", ts: { ...base.ts, q: 5 } };
    const theirs = { ...base, name: "garlic (solo)", ts: { ...base.ts, name: 6 } };
    const m = merge(mine, theirs);
    assert.equal(m.name, "garlic (solo)");
    assert.equal(m.q, "2");
    assert.deepEqual(m.ts, { name: 6, q: 5 });
  });

  it("lets the newer timestamp win a field", () => {
    const a = item({ s: 10 }, { s: "done" });
    const b = item({ s: 12 }, { s: "hidden" });
    assert.equal(merge(a, b).s, "hidden");
    assert.equal(merge(b, a).s, "hidden");
  });

  it("treats a cleared field like any other value", () => {
    const a = item({ q: 10 }, { q: "2 l" });
    const cleared = item({ q: 11 });
    assert.equal("q" in merge(a, cleared), false);
    const older = item({ q: 9 });
    assert.equal(merge(a, older).q, "2 l");
  });

  it("breaks a tie on time by preferring a present value, then the greater JSON", () => {
    const present = item({ q: 10 }, { q: "2" });
    const missing = item({ q: 10 });
    assert.equal(merge(present, missing).q, "2");
    assert.equal(merge(missing, present).q, "2");
    const x = item({ q: 10 }, { q: "a" });
    const y = item({ q: 10 }, { q: "b" });
    assert.equal(merge(x, y).q, "b");
    assert.equal(merge(y, x).q, "b");
  });

  it("counts a field without a timestamp as time 0", () => {
    const old = item({}, { colour: "red" });
    const newer = item({ colour: 3 }, { colour: "blue" });
    assert.equal(merge(old, newer).colour, "blue");
    assert.equal(merge(newer, old).colour, "blue");
  });

  it("merges fields it doesn't know about", () => {
    const a = item({ name: 1, future: 5 }, { name: "x", future: { a: 1 } });
    const b = item({ name: 2 }, { name: "y" });
    const m = merge(a, b);
    assert.deepEqual(m.future, { a: 1 });
    assert.equal(m.name, "y");
  });

  it("lets a permanent delete win over anything, emptying the other fields", () => {
    const live = item({ name: 99, s: 99 }, { name: "x", s: "todo" });
    const dead = { kind: "item", id: "i1", d: true, ts: { d: 5 } };
    assert.deepEqual(merge(live, dead), dead);
    assert.deepEqual(merge(dead, live), dead);
    const dead2 = { kind: "item", id: "i1", d: true, ts: { d: 7 } };
    assert.deepEqual(merge(dead, dead2), dead2);
    assert.deepEqual(merge(dead2, dead), dead2);
  });

  it("refuses to merge different records", () => {
    assert.throws(() => merge(item({}), { kind: "item", id: "other", ts: {} }));
    assert.throws(() => merge(item({}), { kind: "list", id: "i1", ts: {} }));
  });

  it("is commutative, associative and idempotent", () => {
    let seed = 7;
    const rnd = (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const values = { name: ["a", "b", "c"], q: ["1", "2", undefined], s: ["todo", "done", "hidden"] };
    const version = () => {
      if (rnd(8) === 0) return { kind: "item", id: "i1", d: true, ts: { d: rnd(5) + 1 } };
      const v = { kind: "item", id: "i1", ts: {} };
      for (const [f, opts] of Object.entries(values)) {
        if (rnd(4) === 0) continue;
        const val = opts[rnd(opts.length)];
        if (val !== undefined) v[f] = val;
        v.ts[f] = rnd(4) + 1;
      }
      return v;
    };
    const canon = (r) => JSON.stringify(r, Object.keys(r).sort().concat("name", "q", "s", "d"));
    for (let n = 0; n < 2000; n++) {
      const a = version();
      const b = version();
      const c = version();
      assert.equal(canon(merge(a, b)), canon(merge(b, a)), "commutative");
      assert.equal(canon(merge(merge(a, b), c)), canon(merge(a, merge(b, c))), "associative");
      assert.equal(canon(merge(merge(a, b), b)), canon(merge(a, b)), "idempotent");
      assert.equal(canon(merge(a, a)), canon(merge(a, a)));
    }
  });
});

describe("mergeInto", () => {
  it("returns only the records that changed", () => {
    const byId = new Map();
    const a = item({ name: 1 }, { name: "x" });
    assert.equal(mergeInto(byId, [a]).length, 1);
    assert.equal(mergeInto(byId, [a]).length, 0);
    const b = item({ name: 2 }, { name: "y" });
    assert.deepEqual(mergeInto(byId, [b]), [b]);
  });
});
