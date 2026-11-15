import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canStep, parseQuantity, stepQuantity } from "../../src/core/quantity.js";

const up = (q) => stepQuantity(q, 1);
const down = (q) => stepQuantity(q, -1);

describe("quantity steps", () => {
  it("step the number at the start, keeping the rest", () => {
    assert.equal(up("2 l"), "3 l");
    assert.equal(down("2 l"), "1 l");
    assert.equal(up("3 boxes"), "4 boxes");
    assert.equal(up("9"), "10");
    assert.equal(down(" 10 "), "9");
  });

  it("start at 1 from empty, and go back to empty from a plain 1", () => {
    assert.equal(up(""), "1");
    assert.equal(up(undefined), "1");
    assert.equal(down(""), null);
    assert.equal(down("1"), "");
  });

  it("stop at 1 when a unit follows, so the unit is never left alone", () => {
    assert.equal(down("1 l"), null);
    assert.equal(down("0 l"), null);
    assert.equal(up("0 l"), "1 l");
  });

  it("step grams and millilitres by 100", () => {
    assert.equal(up("500 g"), "600 g");
    assert.equal(down("500 g"), "400 g");
    assert.equal(down("100 g"), null);
    assert.equal(up("250 ml"), "350 ml");
    assert.equal(up("2 glasses"), "3 glasses");
  });

  it("leave alone what they can't step", () => {
    for (const q of ["1,5 l", "1.5 l", "6-pack", "a few", "l", "x2", "1234567"]) {
      assert.equal(canStep(q), false, q);
      assert.equal(up(q), null, q);
      assert.equal(down(q), null, q);
    }
    assert.deepEqual(parseQuantity("2 l"), { n: 2, rest: " l" });
  });
});
