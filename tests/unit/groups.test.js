// Sharing groups: keys, codes, a group's name and picture, and its events. Nothing in the app uses these yet.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CodeError, decodeCode, encodeCode, joinLink, readJoin, showCode } from "../../src/groups/code.js";
import { EventError, eventId, KIND, nextCreatedAt, openEvent, packChunks, sealEvent } from "../../src/groups/events.js";
import { dTag, groupKeys, newGroupKey } from "../../src/groups/keys.js";
import { groupCells, groupName, groupPicture } from "../../src/groups/look.js";
import { ADJECTIVES, ANIMALS } from "../../src/groups/words.js";

const fixed = Uint8Array.from({ length: 32 }, (_, i) => i * 7 + 1);

describe("group keys", () => {
  it("are 32 random bytes", () => {
    const a = newGroupKey();
    assert.equal(a.length, 32);
    assert.notDeepEqual(a, newGroupKey());
  });
  it("derive the same keys from the same group key, and others from another", async () => {
    const [a, b, c] = await Promise.all([groupKeys(fixed), groupKeys(fixed.slice()), groupKeys(newGroupKey())]);
    assert.equal(a.pubkey, b.pubkey);
    assert.match(a.pubkey, /^[0-9a-f]{64}$/);
    assert.deepEqual(a.look, b.look);
    assert.notEqual(a.pubkey, c.pubkey);
    assert.equal(await dTag(a, "dev1", "recent"), await dTag(b, "dev1", "recent"));
    assert.notEqual(await dTag(a, "dev1", "recent"), await dTag(a, "dev2", "recent"));
    assert.notEqual(await dTag(a, "dev1", "recent"), await dTag(c, "dev1", "recent"));
  });
});

describe("group codes", () => {
  it("round-trip, as a code and as a link", () => {
    for (let i = 0; i < 50; i++) {
      const key = newGroupKey();
      const code = encodeCode(key);
      assert.equal(code.length, 53);
      assert.deepEqual(decodeCode(code), key);
      assert.deepEqual(decodeCode(showCode(code)), key);
      assert.deepEqual(readJoin(joinLink(key)), key);
      assert.deepEqual(readJoin(code), key);
    }
  });
  it("forgive case, spaces, dashes, O for 0 and I or L for 1", () => {
    const code = encodeCode(fixed);
    const sloppy = showCode(code).toLowerCase().replaceAll("0", "o").replaceAll("1", "l").replaceAll(" ", "-");
    assert.deepEqual(decodeCode(sloppy), fixed);
  });
  it("catch a mistyped or swapped character, and a wrong length", () => {
    const code = encodeCode(fixed);
    const at = 10;
    const other = code[at] === "A" ? "B" : "A";
    assert.throws(() => decodeCode(code.slice(0, at) + other + code.slice(at + 1)), CodeError);
    const i = [...code].findIndex((ch, j) => j < 51 && ch !== code[j + 1]);
    const swapped = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2);
    assert.throws(() => decodeCode(swapped), CodeError);
    assert.throws(() => decodeCode(code.slice(1)), /53 characters/);
    assert.throws(() => readJoin("https://example.com/"), CodeError);
  });
});

describe("a group's look", () => {
  it("uses 256 words of each kind, all different", () => {
    for (const list of [ADJECTIVES, ANIMALS]) {
      assert.equal(list.length, 256);
      assert.equal(new Set(list).size, 256);
      for (const w of list) assert.match(w, /^[a-z]+$/);
    }
  });
  it("names the group from bytes 16 and 17", () => {
    const look = new Uint8Array(32);
    look[16] = 0;
    look[17] = 255;
    const [a, b] = groupName(look).split(" ");
    assert.equal(a.toLowerCase(), ADJECTIVES[0]);
    assert.equal(b.toLowerCase(), ANIMALS[255]);
    assert.match(a, /^[A-Z]/);
  });
  it("draws a mirrored pattern", () => {
    const look = Uint8Array.from({ length: 32 }, (_, i) => i);
    const cells = new Set(groupCells(look).map(([x, y]) => `${x},${y}`));
    for (const c of cells) {
      const [x, y] = c.split(",").map(Number);
      assert.ok(cells.has(`${4 - x},${y}`));
    }
    const svg = groupPicture(look, 40);
    assert.match(svg, /^<svg [^>]*width="40"/);
    assert.equal(svg.match(/<rect x=/g)?.length ?? 0, cells.size);
  });
});

describe("group events", async () => {
  const keys = await groupKeys(fixed);
  const body = { records: [{ kind: "item", id: "i1", name: "Milk" }] };

  it("seal and open, signed per NIP-01", async () => {
    const e = await sealEvent(keys, { device: "dev1", name: "recent", body, createdAt: 1700000000 });
    assert.equal(e.kind, KIND);
    assert.equal(e.pubkey, keys.pubkey);
    assert.equal(e.id, eventId(e));
    assert.match(e.sig, /^[0-9a-f]{128}$/);
    assert.deepEqual(e.tags, [["d", await dTag(keys, "dev1", "recent")]]);
    assert.doesNotMatch(e.content, /Milk/);
    assert.deepEqual(await openEvent(keys, e), { v: 1, device: "dev1", name: "recent", ...body });
  });
  it("pad the content, so sizes say little", async () => {
    const a = await sealEvent(keys, { device: "d", name: "recent", body: { records: [] }, createdAt: 1 });
    const b = await sealEvent(keys, { device: "d", name: "recent", body: { records: [{ id: "x" }] }, createdAt: 1 });
    assert.equal(a.content.length, b.content.length);
  });
  it("refuse anything changed, another group's, or passed off as another event", async () => {
    const e = await sealEvent(keys, { device: "dev1", name: "recent", body, createdAt: 5 });
    await assert.rejects(openEvent(keys, { ...e, created_at: 6 }), /wrong ID/);
    const resigned = { ...e, created_at: 6 };
    resigned.id = eventId(resigned);
    await assert.rejects(openEvent(keys, resigned), /wrong signature/);
    await assert.rejects(openEvent(await groupKeys(newGroupKey()), e), /not this group's/);
    // Another of the device's events, with this one's content: the d tag is in the signature and the encryption
    const other = await sealEvent(keys, { device: "dev2", name: "recent", body, createdAt: 5 });
    const swapped = { ...other, content: e.content };
    await assert.rejects(openEvent(keys, swapped), EventError);
  });
  it("tell a newer format apart", async () => {
    const e = await sealEvent(keys, { device: "d", name: "status", body: { v: 2 }, createdAt: 1 });
    await assert.rejects(openEvent(keys, e), (err) => err instanceof EventError && err.newer === true);
  });
  it("are dated later than the one they replace", () => {
    assert.equal(nextCreatedAt(undefined, 1700000000500), 1700000000);
    assert.equal(nextCreatedAt(1700000000, 1700000000500), 1700000001);
    assert.equal(nextCreatedAt(1800000000, 1700000000500), 1800000001);
  });
  it("pack records into chunks of about 16 KB, the same way every time", () => {
    assert.deepEqual(packChunks([]), [[]]);
    const recs = Array.from({ length: 400 }, (_, i) => ({
      kind: i % 10 ? "item" : "list",
      id: `r${String(i).padStart(3, "0")}`,
      name: "x".repeat(100),
    }));
    const chunks = packChunks(recs);
    assert.ok(chunks.length > 1);
    assert.equal(chunks.flat().length, 400);
    for (const c of chunks.slice(0, -1)) {
      const size = JSON.stringify(c).length;
      assert.ok(size > 16 * 1024 && size < 17 * 1024, String(size));
    }
    assert.equal(chunks[0][0].kind, "list");
    assert.deepEqual(packChunks([...recs].reverse()), chunks);
  });
});
