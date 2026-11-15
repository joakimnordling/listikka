import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LISTIKKA } from "../../src/sync/app.js";
import { pairingText, parsePairing } from "../../vendor/lokki-sync/pairing.js";

describe("pairing codes", () => {
  it("are read for Listikka, and Lokki's codes are not", () => {
    const text = pairingText("https://sync.example.com", "lk_abc", LISTIKKA.name);
    assert.ok(text.startsWith("listikka:sync?"));
    assert.deepEqual(parsePairing(text, LISTIKKA.name), { url: "https://sync.example.com", token: "lk_abc" });
    assert.equal(parsePairing(pairingText("https://sync.example.com", "lk_abc", "lokki"), LISTIKKA.name), null);
  });
});
