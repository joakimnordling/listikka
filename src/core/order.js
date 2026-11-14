// Ordering by a fractional sort key o (see the design notes, "Order").
// Keys are strings such as "a0", "a1" and "a0V" between them, compared by code unit.
// Moving something writes only that record.
import { generateKeyBetween } from "fractional-indexing";

const cmp = (x, y) => (x === y ? 0 : x === undefined ? -1 : y === undefined ? 1 : x < y ? -1 : 1);

// Equal keys, possible when two devices insert at the same spot, are ordered by ID.
export const byOrder = (a, b) => cmp(a.o, b.o) || cmp(a.id, b.id);

// A key between two keys; either may be missing for the start or the end.
// When the neighbours share a key, the new one goes just after it.
export function keyBetween(prevKey, nextKey) {
  const p = prevKey ?? null;
  let n = nextKey ?? null;
  if (p !== null && n !== null && n <= p) n = null;
  return generateKeyBetween(p, n);
}

// The key for the end of an already sorted list.
export const keyAtEnd = (sorted) => keyBetween(sorted.at(-1)?.o, null);

// Anchoring a drop to the neighbour it passed: just above ref, or just below it, in the full
// order of the list, so items not on screen (hidden or ticked ones) never move.
// `sorted` is the target list's full order without the moving record.
export function keyBefore(sorted, refId) {
  const i = sorted.findIndex((r) => r.id === refId);
  if (i < 0) return keyAtEnd(sorted);
  return keyBetween(sorted[i - 1]?.o, sorted[i].o);
}

export function keyAfter(sorted, refId) {
  const i = sorted.findIndex((r) => r.id === refId);
  if (i < 0) return keyAtEnd(sorted);
  return keyBetween(sorted[i].o, sorted[i + 1]?.o);
}
