// + and − next to an item's quantity. The quantity is free text, so they only step a whole number at its start and
// keep the rest as typed: "2 l" → "3 l", "3 boxes" → "4 boxes". An empty quantity steps to "1". Grams and
// millilitres step by 100. Text they can't step ("1,5 l", "6-pack", "a few") gets no buttons.

const LEAD = /^(\d{1,6})(\s.*)?$/;
const HUNDREDS = /^\s*(g|ml)\b/i;

/** {n, rest} for a quantity the buttons can step, else null. Empty is {n: 0, rest: ""}. */
export function parseQuantity(q) {
  const t = (q ?? "").trim();
  if (!t) return { n: 0, rest: "" };
  const m = LEAD.exec(t);
  return m ? { n: Number(m[1]), rest: m[2] ?? "" } : null;
}

export const canStep = (q) => parseQuantity(q) !== null;

/**
 * The quantity after + (dir 1) or − (dir -1), or null when that button does nothing. − never goes below 1 while a
 * unit follows the number, so "1 l" stays; a plain "1" goes back to empty.
 */
export function stepQuantity(q, dir) {
  const p = parseQuantity(q);
  if (!p) return null;
  const by = HUNDREDS.test(p.rest) ? 100 : 1;
  if (dir > 0) return `${p.n === 0 && !p.rest ? 1 : p.n + by}${p.rest}`;
  if (p.n - by >= 1) return `${p.n - by}${p.rest}`;
  return p.n >= 1 && !p.rest && by === 1 ? "" : null;
}
