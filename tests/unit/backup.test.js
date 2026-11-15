import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BACKUP_VERSION, backupText, parseBackup, planRestore } from "../../src/core/backup.js";
import { createClock } from "../../src/core/clock.js";
import { edit, newItem, newList, tombstone } from "../../src/core/records.js";
import { unzipFirst, zipOne } from "../../src/core/zip.js";

const clock = createClock(() => 1000);
const shop = newList({ name: "Lidl", o: "a0" }, clock);
const milk = newItem({ name: "Milk", list: shop.id, o: "a0" }, clock);
const eggs = newItem({ name: "Eggs", list: shop.id, o: "a1", q: "10" }, clock);
const gone = tombstone(newItem({ name: "Glue" }, clock), clock);
const all = [milk, gone, eggs, shop];
const NOW = new Date("2026-11-15T10:00:00Z");

const lines = (text) =>
  text
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
const byId = (records) => {
  const m = new Map(records.map((r) => [r.id, r]));
  return (_kind, id) => m.get(id) ?? null;
};

describe("backups", () => {
  it("are JSON Lines: a header, the lists, the items with deleted ones, and a footer", () => {
    const L = lines(backupText(all, NOW));
    assert.deepEqual(L[0], {
      kind: "header",
      format: "listikka",
      version: BACKUP_VERSION,
      exported: "2026-11-15T10:00:00.000Z",
      app: "listikka-web",
    });
    assert.deepEqual(L.at(-1), { kind: "footer" });
    assert.deepEqual(L[1], shop);
    assert.deepEqual(new Set(L.slice(2, -1).map((r) => r.id)), new Set([milk.id, eggs.id, gone.id]));
  });

  it("read back as the same records", () => {
    const b = parseBackup(backupText(all, NOW));
    assert.equal(b.error, undefined);
    assert.equal(b.header.exported, "2026-11-15T10:00:00.000Z");
    assert.deepEqual(new Set(b.records.map((r) => JSON.stringify(r))), new Set(all.map((r) => JSON.stringify(r))));
  });

  it("skip lines of kinds a newer Listikka may add", () => {
    const text = backupText(all, NOW).replace('{"kind":"footer"}', '{"kind":"tag","id":"x"}\n{"kind":"footer"}');
    assert.equal(parseBackup(text).records.length, 4);
  });

  it("refuse other files, newer versions, cut-off files and damaged records", () => {
    const text = backupText(all, NOW);
    assert.match(parseBackup("Milk\nEggs").error, /isn't a Listikka backup/);
    assert.match(parseBackup('{"kind":"header","format":"lokki","version":1}').error, /isn't a Listikka backup/);
    assert.match(parseBackup(text.replace('"version":1', '"version":2')).error, /newer version/);
    assert.match(parseBackup(text.replace('{"kind":"footer"}\n', "")).error, /incomplete/);
    assert.match(parseBackup(text.replace('"name":"Milk"', '"name":5')).error, /isn't a valid item/);
    assert.match(parseBackup(text.replace(`"id":"${eggs.id}"`, '"id":""')).error, /isn't a valid item/);
    assert.match(parseBackup(text.replace('"name":"Lidl"', '"name":"Lidl","ts":"x"')).error, /isn't a valid list/);
  });

  it("go in a .zip and come back out", async () => {
    const text = backupText(all, NOW);
    const blob = await zipOne("listikka-backup.jsonl", new TextEncoder().encode(text));
    const out = await unzipFirst(new Uint8Array(await blob.arrayBuffer()));
    assert.equal(new TextDecoder().decode(out), text);
  });
});

describe("restoring", () => {
  it("onto an empty device adds everything but what was deleted", () => {
    const p = planRestore(all, () => null);
    assert.deepEqual(p.has, { list: 1, item: 2 });
    assert.deepEqual(p.added, { list: 1, item: 2 });
    assert.deepEqual(p.changed, { list: 0, item: 0 });
    assert.deepEqual(new Set(p.records.map((r) => r.id)), new Set([shop.id, milk.id, eggs.id]));
  });

  it("changes nothing where everything is already here", () => {
    const p = planRestore(all, byId(all));
    assert.deepEqual(p.added, { list: 0, item: 0 });
    assert.deepEqual(p.changed, { list: 0, item: 0 });
    assert.deepEqual(p.records, []);
  });

  it("keeps changes made since; brings back older edits only where they're newer", () => {
    const later = createClock(() => 5000);
    const here = [shop, edit(milk, { name: "Oat milk" }, later), { ...eggs, ts: { ...eggs.ts, q: 1 }, q: "6" }];
    const p = planRestore(all, byId(here));
    assert.deepEqual(p.added, { list: 0, item: 0 });
    assert.deepEqual(p.changed, { list: 0, item: 1 }, "only Eggs, whose quantity in the backup is newer");
    assert.deepEqual(
      p.records.map((r) => r.id),
      [eggs.id],
    );
  });

  it("deletes what was deleted permanently before the backup", () => {
    const glue = { kind: "item", id: gone.id, name: "Glue", s: "todo", ts: { name: 1, s: 1 } };
    const p = planRestore(all, byId([shop, milk, eggs, glue]));
    assert.deepEqual(p.changed, { list: 0, item: 1 });
  });
});
