// Merging two versions of the same record (see the design notes, "Merge rules").
// The result is the same whatever order versions arrive in: the merge is commutative,
// associative and idempotent, so every device ends up with the same record.

const FIXED = new Set(["kind", "id", "ts", "d"]);

const json = (v) => (v === undefined ? undefined : JSON.stringify(v));

// For one field: the newer timestamp wins. On equal timestamps a present value beats a
// missing one, and between two values the greater JSON wins. Equal values: either.
function pick(va, ta, vb, tb) {
  if (ta !== tb) return ta > tb ? va : vb;
  if (va === undefined) return vb;
  if (vb === undefined) return va;
  return json(vb) > json(va) ? vb : va;
}

export function merge(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.kind !== b.kind || a.id !== b.id) throw new Error("merge: not the same record");

  // A permanent delete always wins, and empties every other field.
  if (a.d === true || b.d === true) {
    const t = Math.max(a.d === true ? (a.ts?.d ?? 0) : 0, b.d === true ? (b.ts?.d ?? 0) : 0);
    return { kind: a.kind, id: a.id, d: true, ts: { d: t } };
  }

  // Generic over field names, so fields added later merge correctly on older devices.
  const fields = new Set();
  for (const r of [a, b]) {
    for (const f of Object.keys(r)) if (!FIXED.has(f)) fields.add(f);
    for (const f of Object.keys(r.ts || {})) if (!FIXED.has(f)) fields.add(f);
  }
  const out = { kind: a.kind, id: a.id };
  const ts = {};
  for (const f of [...fields].sort()) {
    // A field without a timestamp counts as time 0.
    const ta = a.ts?.[f] ?? 0;
    const tb = b.ts?.[f] ?? 0;
    const v = pick(a[f], ta, b[f], tb);
    if (v !== undefined) out[f] = v;
    const t = Math.max(ta, tb);
    if (t > 0) ts[f] = t;
  }
  out.ts = ts;
  return out;
}

// Merge a batch of versions into a map of records by id.
export function mergeInto(byId, versions) {
  const changed = [];
  for (const v of versions) {
    const cur = byId.get(v.id);
    const next = merge(cur, v);
    if (JSON.stringify(next) !== JSON.stringify(cur)) {
      byId.set(v.id, next);
      changed.push(next);
    }
  }
  return changed;
}
