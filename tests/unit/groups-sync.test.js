// Syncing through a sharing group, with devices made of the app's store and the groups' manager, and small relays
// running in the test (tests/helpers/relay.js).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClock } from "../../src/core/clock.js";
import * as L from "../../src/core/lists.js";
import { edit } from "../../src/core/records.js";
import { createMemoryDb } from "../../src/data/idb.js";
import { createStore } from "../../src/data/store.js";
import { KIND } from "../../src/groups/events.js";
import { newGroupKey } from "../../src/groups/keys.js";
import { createGroups, GROUP_BITS } from "../../src/groups/manager.js";
import { LISTIKKA } from "../../src/sync/app.js";
import { ListikkaDevice } from "../../src/sync/device.js";
import { canonicalJson } from "../../vendor/lokki-sync/crypto.js";
import { NOWHERE, startRelay } from "../helpers/relay.js";

const fast = { timeout: 2000 };

/** A device: the app's store and the groups' manager over an in-memory database, with its own clock. */
async function device(relays, db = createMemoryDb()) {
  const store = createStore(db);
  await store.load();
  const groups = createGroups({
    app: LISTIKKA,
    store: {
      all: () => store.db.all("sync"),
      write: (ops) => store.db.write(ops.map(([op, value]) => ["sync", op, value])),
    },
    makeDevice: () => new ListikkaDevice(store, { keyring: null, save() {} }),
    relays,
    relayOptions: fast,
  });
  await groups.load();
  const clock = createClock();
  const byId = () => L.indexLists(store.lists());
  const item = (name) => store.items().find((i) => !i.d && i.name === name);
  const add = (name, list = "") => store.change([L.addItem(name, list, store.items(), byId(), clock)]);
  const names = () =>
    store
      .items()
      .filter((i) => !i.d)
      .map((i) => i.name)
      .sort();
  return { db, store, groups, clock, byId, item, add, names };
}

/** A round, after any already started (adding a group starts one) and any it asks for after it. */
async function run(groups) {
  for (;;) {
    while (groups.running) await new Promise((r) => setTimeout(r, 5));
    await groups.now();
    clearTimeout(groups.timer);
    if (!groups.running && !groups.again) return;
  }
}

/** Sync each device in turn, as often as asked. */
async function rounds(devices, times = 1) {
  for (let n = 0; n < times; n++) for (const d of devices) await run(d.groups);
}

const view = (d) => canonicalJson([...d.store.lists(), ...d.store.items()].sort((a, b) => (a.id < b.id ? -1 : 1)));

describe("a sharing group", () => {
  let one, two, relays, key, A, B;
  before(async () => {
    [one, two] = await Promise.all([startRelay(), startRelay()]);
    relays = [one.url, two.url];
    key = newGroupKey();
    A = await device(relays);
    B = await device(relays);
  });
  after(() => Promise.all([one.close(), two.close()]));

  it("the first device publishes its lists, encrypted", async () => {
    const lidl = L.createList("Lidl", [], A.clock);
    await A.store.change([lidl]);
    await A.add("Milk", lidl.id);
    await A.add("Eggs", lidl.id);
    const g = await A.groups.add(key);
    assert.ok(g.bit >= GROUP_BITS.from && g.bit <= GROUP_BITS.to);
    await run(A.groups);
    assert.equal(A.groups.groups[0].last.ok, true, A.groups.groups[0].last.error);
    assert.equal(A.groups.status().groups[0].lacks, 0);
    for (const r of [one, two]) {
      assert.ok(r.events.size > 0);
      for (const e of r.events.values()) {
        assert.equal(e.kind, KIND);
        assert.doesNotMatch(e.content, /Milk|Lidl/);
      }
    }
  });

  it("another device joins with the key, gets the lists, and sends its own", async () => {
    await B.add("Soap");
    await B.groups.add(key);
    await rounds([B, A]);
    assert.deepEqual(B.names(), ["Eggs", "Milk", "Soap"]);
    assert.deepEqual(A.names(), ["Eggs", "Milk", "Soap"]);
    assert.equal(view(A), view(B));
    assert.equal(A.groups.status().groups[0].name, B.groups.status().groups[0].name);
  });

  it("edits to different fields of one item, at the same time, are both kept", async () => {
    await A.store.change([edit(A.item("Milk"), { name: "Oat milk" }, A.clock)]);
    await B.store.change([edit(B.item("Milk"), { q: "2 l" }, B.clock)]);
    await rounds([A, B, A]);
    for (const d of [A, B]) assert.equal(d.item("Oat milk").q, "2 l");
    assert.equal(view(A), view(B));
  });

  it("a deleted item stays deleted on every device", async () => {
    const soap = A.item("Soap");
    await A.store.change([{ ...soap, d: true }]);
    await rounds([A, B]);
    assert.ok(B.store.get("item", soap.id).d);
  });

  it("a device that has nothing new publishes nothing, and reads nothing it read before", async () => {
    await rounds([A, B]);
    const published = one.published;
    await rounds([A, B]);
    assert.equal(one.published, published);
    assert.equal(A.groups.groups[0].last.report.pulled, 0);
  });

  it("keeps working while one of its relays can't be reached", async () => {
    const C = await device([one.url, NOWHERE]);
    const g = await C.groups.add(key);
    await run(C.groups);
    assert.equal(g.last.ok, true, g.last.error);
    assert.ok(C.item("Oat milk"));
    const [up, down] = C.groups.status().groups[0].relays;
    assert.equal(up.read.ok, true);
    assert.equal(down.read.ok, false);
    assert.match(down.read.message, /Can't reach it/);
    await C.add("Butter");
    await run(C.groups);
    await run(A.groups);
    assert.ok(A.item("Butter"));
  });

  it("says so when none of its relays can be reached, and keeps the change waiting", async () => {
    const D = await device([NOWHERE]);
    await D.add("Jam");
    const g = await D.groups.add(key);
    await run(D.groups);
    assert.equal(g.last.ok, false);
    assert.match(g.last.error, /Can't reach/);
    assert.equal(D.groups.status().failing, true);
    assert.equal(D.groups.status().groups[0].lacks, 1);
  });

  it("an edit made while an event is on its way isn't taken as published, and goes next time", async () => {
    await A.add("Rye bread");
    const pool = (await import("../../src/groups/relay.js")).RelayPool.prototype;
    const publish = pool.publish;
    let once = true;
    pool.publish = async function (event) {
      const answer = await publish.call(this, event);
      if (once) {
        once = false;
        await A.store.change([edit(A.item("Rye bread"), { q: "2" }, A.clock)]);
      }
      return answer;
    };
    try {
      await run(A.groups);
    } finally {
      pool.publish = publish;
    }
    assert.equal(A.groups.status().groups[0].lacks, 1, "the edit still waits");
    await rounds([A, B]);
    assert.equal(B.item("Rye bread").q, "2");
  });

  it("carries on where it was after the app starts again", async () => {
    const again = await device(relays, A.db);
    assert.equal(again.groups.groups.length, 1);
    assert.equal(again.groups.status().groups[0].lacks, 0);
    await run(again.groups);
    assert.equal(again.groups.groups[0].last.report.pulled, 0, "nothing read twice");
    await again.add("Honey");
    await rounds([again, B]);
    assert.ok(B.item("Honey"));
  });

  it("leaving a group keeps the lists here, and its bit is clear for the next", async () => {
    const C = await device(relays);
    const g = await C.groups.add(key);
    await run(C.groups);
    assert.ok(C.item("Honey"));
    await C.groups.remove(g.bit);
    assert.ok(C.item("Honey"));
    assert.equal(C.groups.groups.length, 0);
    const other = await C.groups.add(newGroupKey());
    assert.equal(other.bit, g.bit);
    assert.ok(C.groups.status().groups[0].lacks > 0, "a new group gets everything");
  });
});

describe("a big group's lists", () => {
  let relay, key;
  before(async () => {
    relay = await startRelay();
    key = newGroupKey();
  });
  after(() => relay.close());

  it("go into chunks once they pass a chunk's size, and a new device gets them all", async () => {
    const A = await device([relay.url]);
    const lidl = L.createList("Lidl", [], A.clock);
    await A.store.change([lidl]);
    const many = [];
    for (let n = 0; n < 300; n++) many.push(L.addItem(`Item ${n} ${"x".repeat(60)}`, lidl.id, many, A.byId(), A.clock));
    await A.store.change(many);
    const g = await A.groups.add(key);
    await run(A.groups);
    assert.equal(g.last.report.compacted, true);
    assert.ok(g.chunks > 1);
    assert.deepEqual(g.recent, []);

    // A small change after that goes in "recent" only
    await A.add("Pepper", lidl.id);
    await run(A.groups);
    assert.equal(g.last.report.compacted, false);
    assert.deepEqual(g.recent.length, 1);

    const B = await device([relay.url]);
    await B.groups.add(key);
    await run(B.groups);
    assert.equal(B.names().length, 301);
    assert.ok(B.item("Pepper"));
  });
});

describe("a group's only device", () => {
  it("gets its own lists back from the group after they were cleared here", async () => {
    const relay = await startRelay();
    const db = createMemoryDb();
    const A = await device([relay.url], db);
    await A.add("Milk");
    const g = await A.groups.add(newGroupKey());
    await run(A.groups);
    assert.equal(g.last.ok, true, g.last.error);
    // As Clear data's "Clear and download again" does: the lists go, and the group reads everything again
    await db.clear(["lists", "items"]);
    await db.write([["sync", "put", { ...g, heads: {}, last: null }]]);
    const again = await device([relay.url], db);
    assert.deepEqual(again.names(), []);
    await run(again.groups);
    assert.deepEqual(again.names(), ["Milk"]);
    assert.equal(again.groups.status().groups[0].lacks, 0, "and knows the group has them");
    await relay.close();
  });
});
