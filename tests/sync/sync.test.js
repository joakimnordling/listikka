// Listikka's sync against Lokki's real Python server: devices made of the app's store and sync manager, as in the
// app, without the screens. Covers setting up and joining the vault, field-by-field merges, deletes and the
// passphrase. Run scripts/fetch-lokki-server.sh first; needs uv.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createClock } from "../../src/core/clock.js";
import * as L from "../../src/core/lists.js";
import { edit } from "../../src/core/records.js";
import { createMemoryDb } from "../../src/data/idb.js";
import { createStore } from "../../src/data/store.js";
import { createSync } from "../../src/sync/manager.js";
import { WrongPassphraseError } from "../../vendor/lokki-sync/crypto.js";
import { startServer } from "./server.js";

const PASS = "bilberry pie on sunday";

/** A device: the app's store and sync manager over an in-memory database, with its own clock. */
async function device() {
  const store = createStore(createMemoryDb());
  await store.load();
  const sync = createSync(store, { onSynced: () => {} });
  await sync.load();
  const clock = createClock();
  const byId = () => L.indexLists(store.lists());
  const item = (name) => store.items().find((i) => !i.d && i.name === name);
  return { store, sync, clock, byId, item };
}

/** Joins the vault on this server: creates it when the server is empty. */
async function join(d, url, token, pass = PASS) {
  const { keyring } = await d.sync.inspect(url, token);
  if (keyring) await d.sync.joinVault(keyring, pass);
  else await d.sync.createVault(pass);
  await d.sync.addServer(url, token);
  await d.sync.now();
}

/** What a device holds, comparable between devices. */
const view = (d) => JSON.stringify([...d.store.lists(), ...d.store.items()].sort((a, b) => (a.id < b.id ? -1 : 1)));

describe("syncing through Lokki's server", () => {
  let server, vault, A, B, lidl;
  before(async () => {
    server = await startServer();
    vault = await server.vault();
    A = await device();
    B = await device();
  });
  after(() => server.stop());

  it("the first device sets up the vault and sends its lists", async () => {
    lidl = L.createList("Lidl", A.store.lists(), A.clock);
    await A.store.change([lidl]);
    for (const name of ["Milk", "Eggs"])
      await A.store.change([L.addItem(name, lidl.id, A.store.items(), A.byId(), A.clock)]);
    await join(A, server.url, vault.write);
    assert.equal(A.sync.status().onlyHere, 0);
    assert.ok(
      A.sync.servers.every((s) => s.bit <= 14),
      "servers keep to bits 0 to 14",
    );
    assert.ok(A.sync.status().servers[0].last.ok);
  });

  it("a second device is refused with the wrong passphrase", async () => {
    const { keyring } = await B.sync.inspect(server.url, vault.write);
    await assert.rejects(B.sync.joinVault(keyring, "not the passphrase"), WrongPassphraseError);
  });

  it("with the right one, it gets the lists and sends its own items", async () => {
    await B.store.change([L.addItem("Batteries", "", B.store.items(), B.byId(), B.clock)]);
    await join(B, server.url, vault.write);
    await A.sync.now();
    assert.deepEqual(
      L.itemsIn(B.store.items(), lidl.id, B.byId()).map((i) => i.name),
      ["Milk", "Eggs"],
    );
    assert.ok(A.item("Batteries"));
    assert.equal(view(A), view(B));
  });

  it("edits to different fields of one item, made at the same time, are both kept", async () => {
    await A.store.change([edit(A.item("Milk"), { name: "Oat milk" }, A.clock)]);
    await B.store.change([edit(B.item("Milk"), { q: "2 l" }, B.clock)]);
    await A.sync.now();
    await B.sync.now();
    await A.sync.now();
    for (const d of [A, B]) assert.deepEqual([d.item("Oat milk")?.name, d.item("Oat milk")?.q], ["Oat milk", "2 l"]);
    assert.equal(view(A), view(B));
  });

  it("edits to the same field: the later one wins on both devices", async () => {
    await A.store.change([L.tick(A.item("Eggs"), A.clock)]);
    await B.store.change([L.removeItem(B.item("Eggs"), B.clock)]);
    await A.sync.now();
    await B.sync.now();
    await A.sync.now();
    assert.equal(A.item("Eggs").s, "hidden");
    assert.equal(view(A), view(B));
  });

  it("a permanent delete wins over adding back at the same time", async () => {
    const eggs = A.item("Eggs");
    await A.store.change([L.deleteItem(eggs, A.clock)]);
    await B.store.change([L.addBack(B.item("Eggs"), lidl.id, B.store.items(), B.byId(), B.clock)]);
    await B.sync.now();
    await A.sync.now();
    await B.sync.now();
    for (const d of [A, B]) assert.equal(d.store.get("item", eggs.id).d, true);
    assert.equal(view(A), view(B));
  });

  it("an item added to a list deleted at the same time shows under the unnamed list", async () => {
    await A.store.change(L.deleteList(A.store.get("list", lidl.id), A.store.items(), A.clock));
    const cheese = L.addItem("Cheese", lidl.id, B.store.items(), B.byId(), B.clock);
    await B.store.change([cheese]);
    await A.sync.now();
    await B.sync.now();
    await A.sync.now();
    for (const d of [A, B]) {
      assert.equal(L.listKeyOf(d.item("Cheese"), d.byId()), L.UNNAMED);
      assert.ok(d.store.get("list", lidl.id).d);
    }
    assert.equal(view(A), view(B));
  });

  it("after a passphrase change, a new device joins only with the new one", async () => {
    await A.sync.changePassphrase(PASS, "lingonberry jam on monday");
    await A.sync.now();
    const C = await device();
    const { keyring } = await C.sync.inspect(server.url, vault.write);
    await assert.rejects(C.sync.joinVault(keyring, PASS), WrongPassphraseError);
    await join(C, server.url, vault.write, "lingonberry jam on monday");
    assert.ok(C.item("Cheese"));
    // A device set up before the change keeps working
    await B.store.change([L.addItem("Bread", "", B.store.items(), B.byId(), B.clock)]);
    await B.sync.now();
    await C.sync.now();
    assert.ok(C.item("Bread"));
  });

  it("an edit made while a push is on its way is sent too, not taken as sent", async () => {
    await B.sync.now();
    await A.sync.now();
    await A.store.change([L.addItem("Rye bread", "", A.store.items(), A.byId(), A.clock)]);
    const make = A.sync.client.bind(A.sync);
    A.sync.client = (url, token) => {
      const http = make(url, token);
      const push = http.push.bind(http);
      http.push = async (...args) => {
        const answer = await push(...args);
        http.push = push;
        // after the server took it, before this device marks it as sent
        await A.store.change([edit(A.item("Rye bread"), { q: "2" }, A.clock)]);
        return answer;
      };
      return http;
    };
    await A.sync.now();
    A.sync.client = make;
    assert.equal(A.sync.status().waiting, 0);
    await B.sync.now();
    assert.equal(B.item("Rye bread").q, "2");
  });
});
