import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LISTIKKA } from "../../src/sync/app.js";
import { sameRecord } from "../../vendor/lokki-sync/crypto.js";
import { MemoryDevice } from "../../vendor/lokki-sync/memory.js";

const item = (ts, fields) => ({ kind: "item", id: "i1", ...fields, ts });

describe("Listikka's sync settings", () => {
  it("name the app and its kinds", () => {
    assert.equal(LISTIKKA.name, "listikka");
    assert.deepEqual(LISTIKKA.kinds, ["list", "item"]);
  });

  it("give back the same record when merging a record with itself, as the engine requires", () => {
    const r = item({ name: 3, q: 4 }, { name: "Milk", q: "2 l" });
    assert.ok(sameRecord(LISTIKKA.merge(r, r), r));
  });

  it("merge field by field on the in-memory device, keeping server bits when nothing changes", async () => {
    const d = new MemoryDevice({ merge: LISTIKKA.merge });
    const fromServer = item({ name: 2, q: 2 }, { name: "Garlic", q: "1" });
    await d.apply([fromServer], 0);
    assert.equal(d.pending(0).length, 0);
    // An older edit of the quantity changes nothing
    assert.equal(d.put(item({ q: 1 }, { q: "3" })), false);
    assert.equal(d.pending(0).length, 0);
    // A newer edit of the name on this device keeps the server's quantity
    assert.equal(d.put(item({ name: 5 }, { name: "Garlic (solo)" })), true);
    assert.deepEqual(d.pending(0), [item({ name: 5, q: 2 }, { name: "Garlic (solo)", q: "1" })]);
  });
});
