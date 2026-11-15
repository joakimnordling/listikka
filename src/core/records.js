// Lists and items: flat records with a timestamp per editable field (see the design notes, "Records").
import { uuid4 } from "./ids.js";

export const KINDS = ["list", "item"];
export const EDITABLE = {
  list: ["name", "s", "o"],
  item: ["list", "name", "q", "note", "s", "o"],
};
export const LIST_STATES = ["active", "hidden"];
export const ITEM_STATES = ["todo", "done", "hidden"];

// A field is cleared by leaving it out of the record while keeping its timestamp; no null is stored.
const isEmpty = (v) => v === undefined || v === null || v === "";

function withFields(rec, fields, t) {
  const out = { ...rec, ts: { ...rec.ts } };
  let changed = false;
  for (const [f, v] of Object.entries(fields)) {
    if (f === "kind" || f === "id" || f === "ts" || f === "d") throw new Error(`records: ${f} can't be edited`);
    const next = isEmpty(v) ? undefined : v;
    if (next === out[f] && f in out.ts) continue;
    if (next === undefined) delete out[f];
    else out[f] = next;
    out.ts[f] = t;
    changed = true;
  }
  return changed ? out : rec;
}

function create(kind, fields, clock) {
  const rec = { kind, id: uuid4(), ts: {} };
  const t = clock.now();
  const present = Object.fromEntries(Object.entries(fields).filter(([, v]) => !isEmpty(v)));
  return withFields(rec, present, t);
}

export const newList = (fields, clock) => create("list", { s: "active", ...fields }, clock);
export const newItem = (fields, clock) => create("item", { s: "todo", ...fields }, clock);

// One edit: every changed field gets the same new timestamp. Unchanged fields keep theirs,
// and a deleted record can't be edited. Returns the same object when nothing changed.
export function edit(rec, fields, clock) {
  if (isDeleted(rec)) return rec;
  const t = clock.now();
  return withFields(rec, fields, t);
}

// A permanent delete keeps only kind, id, d and ts for d.
export function tombstone(rec, clock) {
  if (isDeleted(rec)) return rec;
  return { kind: rec.kind, id: rec.id, d: true, ts: { d: clock.now() } };
}

export const isDeleted = (rec) => rec?.d === true;
export const isLive = (rec) => !!rec && !isDeleted(rec);
export const state = (rec) => rec.s || (rec.kind === "list" ? "active" : "todo");

// The largest timestamp stands in for "last changed", for example when sorting.
export const lastChanged = (rec) => Math.max(0, ...Object.values(rec?.ts || {}));
