/* What taps and sheets do, registered by each ui module: onActs() for the elements with data-act, sheetBodies() for
   each kind of sheet. One click listener runs the actions. This module imports no other ui module, so the others can
   register while they load. */
import { getItem, S } from "./state.js";

const actions = {};
const bodies = {};

/** Adds actions: {"data-act value": ({e, b, act, key, li, id, item}) => …}. */
export function onActs(map) {
  Object.assign(actions, map);
}

/** Adds sheet bodies: {type: (err) => html, or null to close the sheet}. */
export function sheetBodies(map) {
  Object.assign(bodies, map);
}

export const sheetBody = (type, err) => bodies[type]?.(err) ?? null;

document.addEventListener(
  "click",
  (e) => {
    if (S.suppressClick) {
      S.suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    const sec = b.closest("[data-list]");
    const li = b.closest("li[data-id]");
    const id = li?.dataset.id;
    actions[act]?.({
      e,
      b,
      act,
      key: sec ? sec.dataset.list : S.sheet?.key,
      li,
      id,
      item: id ? getItem(id) : null,
    });
  },
  true,
);
