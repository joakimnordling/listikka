import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClock } from "../../src/core/clock.js";
import { addItem, createList, indexLists, tick } from "../../src/core/lists.js";
import { createMemoryDb } from "../../src/data/idb.js";
import { createStore } from "../../src/data/store.js";
import { ListikkaDevice } from "../../src/sync/device.js";

const clock = () => {
  let t = 1000;
  return createClock(() => t++);
};

async function setup() {
  const db = createMemoryDb();
  const store = createStore(db);
  await store.load();
  const c = clock();
  const lidl = createList("Lidl", store.lists(), c);
  const milk = addItem("Milk", lidl.id, store.items(), indexLists([lidl]), c);
  await store.change([lidl, milk]);
  return { db, store, c, lidl, milk };
}

describe("the store", () => {
  it("keeps local changes in memory and in the database, with no server bits", async () => {
    const { db, store, lidl, milk } = await setup();
    assert.equal(store.get("list", lidl.id).name, "Lidl");
    assert.deepEqual(
      (await db.all("items")).map((r) => [r.name, r.sb]),
      [["Milk", 0]],
    );
    const again = createStore(db);
    await again.load();
    assert.deepEqual(again.get("item", milk.id), milk);
    assert.equal(again.bits("item", milk.id), 0);
  });

  it("merges a local change with the version kept here, and skips changes that change nothing", async () => {
    const { store, c, milk } = await setup();
    await store.put([milk], 0b1);
    assert.deepEqual(await store.change([milk]), []);
    assert.equal(store.bits("item", milk.id), 1, "keeps its bits");
    const ticked = tick(milk, c);
    const [saved] = await store.change([ticked]);
    assert.equal(saved.s, "done");
    assert.equal(store.bits("item", milk.id), 0, "every server lacks it now");
  });

  it("tells listeners about changes", async () => {
    const { store, c, milk } = await setup();
    let calls = 0;
    store.onChange(() => calls++);
    await store.change([tick(milk, c)]);
    await store.change([store.get("item", milk.id)]);
    assert.equal(calls, 1);
  });
});

describe("the sync device", () => {
  const vault = () => ({
    keyring: null,
    save(k) {
      this.keyring = k;
    },
  });

  it("lists what a server lacks, lists before items", async () => {
    const { store, lidl, milk } = await setup();
    const d = new ListikkaDevice(store, vault());
    assert.deepEqual(
      d.pending(0).map((r) => r.id),
      [lidl.id, milk.id],
    );
    d.markHas("list", lidl.id, 0);
    assert.deepEqual(
      d.pending(0).map((r) => r.id),
      [milk.id],
    );
    assert.deepEqual(d.lacking([0, 1]), { missing: 2, nowhere: 1 });
    assert.ok(d.anyNowhere([0]));
  });

  it("stores pulled records with one server's bit, and merged ones with none", async () => {
    const { store, c, milk } = await setup();
    const d = new ListikkaDevice(store, vault());
    const theirs = tick(milk, c);
    await d.apply([theirs], 2);
    assert.equal(store.bits("item", milk.id), 0b100);
    await d.apply([theirs], null);
    assert.equal(store.bits("item", milk.id), 0);
  });

  it("saves changed bits and unreadable rows together with the servers' state", async () => {
    const { db, store, lidl } = await setup();
    const d = new ListikkaDevice(store, vault());
    d.markHas("list", lidl.id, 1);
    d.markUnreadable("rowkey", 1);
    await d.persist([["put", { k: "server:1", bit: 1, cursor: 7 }]]);
    assert.equal((await db.all("lists"))[0].sb, 0b10);
    assert.deepEqual(
      (await db.all("sync")).sort((a, b) => (a.k < b.k ? -1 : 1)),
      [
        { k: "server:1", bit: 1, cursor: 7 },
        { k: "unreadable:rowkey", bits: 0b10 },
      ],
    );
    // A device started later reads the unreadable rows back
    const later = new ListikkaDevice(
      store,
      vault(),
      (await db.all("sync")).filter((r) => r.k.startsWith("unreadable:")),
    );
    assert.equal(later.unreadable("rowkey"), 0b10);
    later.clearBit(1);
    assert.equal(later.unreadable("rowkey"), 0);
    assert.equal(store.bits("list", lidl.id), 0);
    await later.persist();
    assert.deepEqual(
      (await db.all("sync")).map((r) => r.k),
      ["server:1"],
    );
  });

  it("never saves an older version over an edit made after a server got it", async () => {
    const { db, store, c, milk } = await setup();
    const d = new ListikkaDevice(store, vault());
    d.markHas("item", milk.id, 1); // a server got Milk; its bits are saved at the end of the round
    const ticked = tick(milk, c);
    await store.change([ticked]); // ticked meanwhile, which no server has
    await d.persist();
    const [row] = await db.all("items");
    assert.equal(row.s, "done");
    assert.equal(row.sb, 0);
  });

  it("keeps the keyring in the vault", async () => {
    const { store } = await setup();
    const v = vault();
    const d = new ListikkaDevice(store, v);
    d.setKeyring({ vault: "x" });
    assert.deepEqual(d.keyring(), { vault: "x" });
  });
});

describe("the sync manager", () => {
  it("loads with Listikka's store and device, and keeps the vault in the sync store", async () => {
    const { createSync } = await import("../../src/sync/manager.js");
    const { db, store } = await setup();
    const sync = createSync(store);
    await sync.load();
    assert.equal(sync.servers.length, 0);
    assert.ok(sync.device instanceof ListikkaDevice);
    assert.equal(sync.device.lacks(0), 2);
    assert.deepEqual(await db.all("sync"), []);
  });
});
