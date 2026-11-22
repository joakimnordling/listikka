// A device in a sharing group and on a server at once passes changes between the two: A is only on the server, B on
// both, C only in the group. Against Lokki's real Python server and a small relay run by the test.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClock } from "../../src/core/clock.js";
import * as L from "../../src/core/lists.js";
import { edit } from "../../src/core/records.js";
import { createMemoryDb } from "../../src/data/idb.js";
import { createStore } from "../../src/data/store.js";
import { newGroupKey } from "../../src/groups/keys.js";
import { createGroups } from "../../src/groups/manager.js";
import { LISTIKKA } from "../../src/sync/app.js";
import { ListikkaDevice } from "../../src/sync/device.js";
import { createSync } from "../../src/sync/manager.js";
import { startRelay } from "../helpers/relay.js";
import { startServer } from "./server.js";

const PASS = "bilberry pie on sunday";

async function device(relays) {
  const store = createStore(createMemoryDb());
  await store.load();
  const sync = createSync(store, { onSynced: () => {} });
  await sync.load();
  const groups = createGroups({
    app: LISTIKKA,
    store: {
      all: () => store.db.all("sync"),
      write: (ops) => store.db.write(ops.map(([op, value]) => ["sync", op, value])),
    },
    makeDevice: () => new ListikkaDevice(store, { keyring: null, save() {} }),
    relays,
    relayOptions: { timeout: 2000 },
  });
  await groups.load();
  const clock = createClock();
  const item = (name) => store.items().find((i) => !i.d && i.name === name);
  const add = (name) => store.change([L.addItem(name, "", store.items(), L.indexLists(store.lists()), clock)]);
  return { store, sync, groups, clock, item, add };
}

/** A round of `m` (a sync or groups manager), after any it has already started (adding a server or group does) */
async function run(m) {
  while (m.running) await new Promise((r) => setTimeout(r, 10));
  await m.now();
}

async function join(d, url, token) {
  const { keyring } = await d.sync.inspect(url, token);
  if (keyring) await d.sync.joinVault(keyring, PASS);
  else await d.sync.createVault(PASS);
  await d.sync.addServer(url, token);
}

describe("a server and a group together", () => {
  let server, relay, vault, key, A, B, C;
  before(async () => {
    [server, relay] = await Promise.all([startServer(), startRelay()]);
    vault = await server.vault();
    key = newGroupKey();
    A = await device([relay.url]);
    B = await device([relay.url]);
    C = await device([relay.url]);
    await join(A, server.url, vault.write);
    await run(A.sync); // the vault, before B joins it
    await join(B, server.url, vault.write);
    await B.groups.add(key);
    await C.groups.add(key);
  });
  after(async () => {
    await server.stop();
    await relay.close();
  });

  /** B syncs its server and its group, in either order, both at once */
  const bridge = async () => {
    await Promise.all([run(B.sync), run(B.groups)]);
    await Promise.all([run(B.sync), run(B.groups)]);
  };

  it("a change on the server reaches the group", async () => {
    await A.add("Milk");
    await run(A.sync);
    await bridge();
    await run(C.groups);
    assert.ok(C.item("Milk"));
  });

  it("a change in the group reaches the server", async () => {
    await C.add("Eggs");
    await run(C.groups);
    await bridge();
    await run(A.sync);
    assert.ok(A.item("Eggs"));
  });

  it("edits on both sides at once are merged everywhere", async () => {
    await A.store.change([edit(A.item("Milk"), { name: "Oat milk" }, A.clock)]);
    await C.store.change([edit(C.item("Milk"), { q: "2 l" }, C.clock)]);
    await run(A.sync);
    await run(C.groups);
    await bridge();
    await run(A.sync);
    await run(C.groups);
    for (const d of [A, B, C]) assert.equal(d.item("Oat milk")?.q, "2 l");
  });

  it("the bridging device ends with nothing waiting for either", async () => {
    await bridge();
    assert.equal(B.sync.status().onlyHere, 0);
    assert.equal(B.sync.status().waiting, 0);
    assert.equal(B.groups.status().groups[0].lacks, 0);
    for (const s of B.sync.servers) assert.ok(s.bit <= 14);
    assert.ok(B.groups.groups[0].bit >= 15);
  });
});
