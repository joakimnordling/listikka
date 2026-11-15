import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { generate, inner, NAMES, OUT } from "../../scripts/build-icons.js";
import { ICON_NAMES, svg } from "../../src/ui/icons.js";
import { LUCIDE } from "../../src/ui/lucide.js";

describe("icons", () => {
  it("src/ui/lucide.js is up to date with lucide-static (run npm run icons)", async () => {
    assert.equal(await readFile(OUT, "utf8"), await generate());
  });
  it("draws the icons exactly as Lucide does", async () => {
    assert.equal(LUCIDE["trash-2"], await inner("trash-2"));
    assert.match(LUCIDE["chevron-right"], /^<path d="m9 18 6-6-6-6"\/>$/);
  });
  it("has an icon for every role, and generates only the icons in use", () => {
    for (const role of Object.keys(ICON_NAMES)) assert.doesNotMatch(svg(role), /undefined/, role);
    assert.deepEqual([...new Set(Object.values(ICON_NAMES))].sort(), [...NAMES].sort());
    assert.deepEqual(Object.keys(LUCIDE).sort(), [...NAMES].sort());
  });
});
