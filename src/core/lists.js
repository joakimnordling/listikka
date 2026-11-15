// What the screens do with lists and items. Every function is pure: it takes records and
// returns the records it changed (new versions), ready to save and sync. Nothing here deletes
// on the side: deleting a list is one explicit action, and the merge never cascades.
import { matchKey } from "./names.js";
import { byOrder, keyAfter, keyAtEnd, keyBefore } from "./order.js";
import { edit, isLive, lastChanged, newItem, newList, state, tombstone } from "./records.js";

// The unnamed list, for items without a list, has the key "".
export const UNNAMED = "";

// Lists in their order: the active ones shown on the main screen, and the removed ones in Settings.
export const activeLists = (lists) => lists.filter((l) => isLive(l) && state(l) === "active").sort(byOrder);
export const removedLists = (lists) => lists.filter((l) => isLive(l) && state(l) === "hidden").sort(byOrder);

// Which list an item shows under. An item whose list was deleted (because someone added or
// moved it there at the same time) stays live and shows under the unnamed list; showing it writes nothing.
export function listKeyOf(item, listsById) {
  const l = item.list ? listsById.get(item.list) : undefined;
  return l && isLive(l) ? item.list : UNNAMED;
}

export const indexLists = (lists) => new Map(lists.map((l) => [l.id, l]));

// Every live item of a list, in order, whatever its state.
export const itemsIn = (items, key, listsById) =>
  items.filter((i) => isLive(i) && listKeyOf(i, listsById) === key).sort(byOrder);

// What a list shows: unticked and ticked items in place, removed ones only in "Show removed items",
// where the list is grouped into unticked, ticked and removed, each in its stored order.
export function shownItems(sorted, { hideTicked = false, showRemoved = false } = {}) {
  if (showRemoved) return ["todo", "done", "hidden"].flatMap((s) => sorted.filter((i) => state(i) === s));
  return sorted.filter((i) => state(i) === "todo" || (state(i) === "done" && !hideTicked));
}

// The dim count next to a list's name; 0 means none is shown.
export const uncheckedCount = (sorted) => sorted.filter((i) => state(i) === "todo").length;

// --- Lists ---

export function createList(name, lists, clock) {
  const o = keyAtEnd(lists.filter(isLive).sort(byOrder));
  return newList({ name, o }, clock);
}

export const renameList = (list, name, clock) => edit(list, { name }, clock);

// Removing a list keeps it and its items; it waits in Settings → Removed lists.
export const removeList = (list, clock) => edit(list, { s: "hidden" }, clock);
export const restoreList = (list, clock) => edit(list, { s: "active" }, clock);

// Deleting permanently, from Removed lists only: the list and every item this device knows on it.
export function deleteList(list, items, clock) {
  const own = items.filter((i) => isLive(i) && i.list === list.id);
  return [tombstone(list, clock), ...own.map((i) => tombstone(i, clock))];
}

// Moving a list among the active ones: `others` is the active lists in order without it.
export function moveList(list, others, { before, after } = {}, clock) {
  const o = before ? keyBefore(others, before) : after ? keyAfter(others, after) : keyAtEnd(others);
  return edit(list, { o }, clock);
}

// --- Items ---

// A fresh item at the end of its list. Two items with the same name may be on a list at once.
export function addItem(name, key, items, listsById, clock) {
  const o = keyAtEnd(itemsIn(items, key, listsById));
  return newItem({ list: key || undefined, name, o }, clock);
}

export const tick = (item, clock) => edit(item, { s: state(item) === "done" ? "todo" : "done" }, clock);

// Removing keeps every field; the item becomes a suggestion and can be added back.
export const removeItem = (item, clock) => edit(item, { s: "hidden" }, clock);

export const removeTicked = (sorted, clock) =>
  sorted.filter((i) => state(i) === "done").map((i) => edit(i, { s: "hidden" }, clock));

export const deleteItem = (item, clock) => tombstone(item, clock);

// Edits from the item sheet: name, quantity, note and list. A move to another list puts it at
// the end there, written in the same edit as list.
export function editItem(item, { name, q, note, list }, items, listsById, clock) {
  const fields = {};
  if (name?.trim()) fields.name = name;
  if (q !== undefined) fields.q = q;
  if (note !== undefined) fields.note = note;
  if (list !== undefined && list !== listKeyOf(item, listsById)) {
    fields.list = list || undefined;
    fields.o = keyAtEnd(itemsIn(items, list, listsById).filter((i) => i.id !== item.id));
  }
  return edit(item, fields, clock);
}

// Bringing a removed item back: s becomes todo and everything else is kept, including its place.
// From another list it also moves here, to the end, with its quantity and note.
export function addBack(item, key, items, listsById, clock, changes = {}) {
  const fields = { s: "todo" };
  for (const f of ["name", "q", "note"]) if (changes[f] !== undefined) fields[f] = changes[f];
  if (fields.name !== undefined && !fields.name.trim()) delete fields.name;
  if (listKeyOf(item, listsById) !== key) {
    fields.list = key || undefined;
    fields.o = keyAtEnd(itemsIn(items, key, listsById).filter((i) => i.id !== item.id));
  }
  return edit(item, fields, clock);
}

// A drop after dragging: just above or below the item it was dropped on, or at the end of a
// list when dropped on its title or add row. `sorted` is the target list's full order.
export function moveItem(item, key, sorted, { before, after } = {}, clock) {
  const rest = sorted.filter((i) => i.id !== item.id);
  const o = before ? keyBefore(rest, before) : after ? keyAfter(rest, after) : keyAtEnd(rest);
  const fields = { o };
  if (item.list !== (key || undefined)) fields.list = key || undefined;
  return edit(item, fields, clock);
}

// --- Suggestions while typing ---

// Removed items whose name contains what was typed, from this list first, then from the others.
// Several with the same name are shown once: the one from this list if there is one, otherwise
// the most recently removed. Best matches first.
export function suggestions(typed, key, items, listsById, limit = 4) {
  const q = matchKey(typed);
  if (!q) return [];
  const best = new Map();
  for (const i of items) {
    if (!isLive(i) || state(i) !== "hidden") continue;
    const k = matchKey(i.name);
    if (!k.includes(q)) continue;
    const cur = best.get(k);
    const here = listKeyOf(i, listsById) === key;
    if (!cur) best.set(k, i);
    else {
      const curHere = listKeyOf(cur, listsById) === key;
      if ((here && !curHere) || (here === curHere && (i.ts?.s ?? 0) > (cur.ts?.s ?? 0))) best.set(k, i);
    }
  }
  const rank = (i) => [
    listKeyOf(i, listsById) === key ? 0 : 1,
    matchKey(i.name).startsWith(q) ? 0 : 1,
    -(i.ts?.s ?? lastChanged(i)),
  ];
  return [...best.values()]
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra[0] - rb[0] || ra[1] - rb[1] || matchKey(a.name).localeCompare(matchKey(b.name)) || ra[2] - rb[2];
    })
    .slice(0, limit);
}
