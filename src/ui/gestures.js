// Swiping rows, holding an item to move it, and holding a list's title to reorder the lists.

import * as L from "../core/lists.js";
import { state } from "../core/records.js";
import { $, $$, esc } from "./dom.js";
import { svg } from "./icons.js";
import { tickItem } from "./lists.js";
import { render } from "./render.js";
import { activeLists, byId, clock, getItem, getList, itemsIn, listOf, S, save, store } from "./state.js";
import { toast } from "./toast.js";

function closeSwipe() {
  if (!S.swipeOpen) return;
  const row = $(`li[data-key="${S.swipeOpen}"] .row`);
  if (row) {
    row.style.transform = "";
    row.classList.remove("open", "open-r");
  }
  S.swipeOpen = null;
}

document.addEventListener("pointerdown", (e) => {
  if (e.button) return;
  S.suppressClick = false;
  if (S.sheet) return;
  if (S.swipeOpen && !e.target.closest(`li[data-key="${S.swipeOpen}"]`)) {
    closeSwipe();
    S.suppressClick = true;
    return;
  }
  const title = e.target.closest("[data-list-title]");
  if (
    title &&
    S.view === "main" &&
    title.dataset.listTitle &&
    !e.target.closest('[data-act="menu"], [data-act="eye"], .chip')
  ) {
    const k = title.dataset.listTitle;
    S.lp = {
      x: e.clientX,
      y: e.clientY,
      pid: e.pointerId,
      timer: setTimeout(() => {
        const p = S.lp;
        S.lp = null;
        if (p) beginReorder(k, p.y, p.pid);
      }, 450),
    };
    return;
  }
  const row = e.target.closest("[data-swipe]");
  if (row) {
    const k = row.closest("li").dataset.key;
    S.g = {
      type: "pending",
      row,
      key: k,
      x: e.clientX,
      y: e.clientY,
      base: S.swipeOpen === k ? (S.swipeDir === "r" ? 88 : -88) : 0,
      dx: 0,
      right: row.hasAttribute("data-right"),
    };
    if (row.hasAttribute("data-hold") && S.view === "main") {
      const li = row.closest("li");
      S.lp = {
        x: e.clientX,
        y: e.clientY,
        pid: e.pointerId,
        timer: setTimeout(() => {
          const p = S.lp;
          S.lp = null;
          S.g = null;
          if (p) startItemDrag(li, p.x, p.y, p.pid);
        }, 450),
      };
    }
  }
});

window.addEventListener("pointermove", (e) => {
  if (S.lp) {
    if (Math.hypot(e.clientX - S.lp.x, e.clientY - S.lp.y) > 8) {
      clearTimeout(S.lp.timer);
      S.lp = null;
    } else {
      S.lp.x = e.clientX;
      S.lp.y = e.clientY;
    }
  }
  if (S.reorder) {
    moveReorder(e.clientY);
    return;
  }
  if (S.drag) {
    moveItemDrag(e.clientX, e.clientY);
    return;
  }
  if (!S.g) return;
  const dx = e.clientX - S.g.x;
  const dy = e.clientY - S.g.y;
  if (S.g.type === "pending") {
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      S.g.type = "swipe";
      S.g.row.style.transition = "none";
      S.suppressClick = true;
    } else if (Math.abs(dy) > 10) {
      S.g = null;
      return;
    }
  }
  if (S.g.type === "swipe") {
    if (!S.g.w) S.g.w = S.g.row.getBoundingClientRect().width;
    S.g.dx = Math.min(S.g.right ? S.g.w * 0.6 : 0, Math.max(-140, S.g.base + dx));
    S.g.row.style.transform = `translateX(${S.g.dx}px)`;
    const li = S.g.row.closest("li");
    const lead = li.querySelector(".swipe-lead");
    const trail = li.querySelector(".swipe-act:not(.swipe-lead)");
    const armed = S.g.dx >= 60; // the icon, in line with the checkboxes, sits centred in the green
    if (armed !== !!S.g.armed) {
      S.g.armed = armed;
      if (armed) navigator.vibrate?.(10);
    }
    if (lead) {
      lead.style.visibility = S.g.dx > 0 ? "visible" : "hidden";
      lead.classList.toggle("armed", armed);
    }
    if (trail) trail.style.visibility = S.g.dx < 0 ? "visible" : "hidden";
  }
});

// Swiping right acts at once: tick, untick, or add back.
function swipeRight(li) {
  if (li.dataset.lid) {
    const l = getList(li.dataset.lid);
    save([L.restoreList(l, clock)]).then(() => toast(`${l.name} is back`));
    return;
  }
  const it = getItem(li.dataset.id);
  if (!it) return;
  if (state(it) === "hidden") save([L.addBack(it, listOf(it), store.items(), byId(), clock)]);
  else tickItem(it);
}

function endGesture(cancelled) {
  if (S.lp) {
    clearTimeout(S.lp.timer);
    S.lp = null;
  }
  if (S.reorder) {
    endReorder(cancelled);
    return;
  }
  if (S.drag) {
    endItemDrag(cancelled);
    return;
  }
  if (S.g && S.g.type === "swipe") {
    S.g.row.style.transition = "";
    const li = S.g.row.closest("li");
    if (!cancelled && S.g.right && S.g.armed) {
      S.g.row.style.transform = "";
      if (S.swipeOpen === S.g.key) S.swipeOpen = null;
      S.g = null;
      swipeRight(li);
      return;
    }
    if (!cancelled && S.g.dx < -50) {
      if (S.swipeOpen && S.swipeOpen !== S.g.key) closeSwipe();
      S.swipeOpen = S.g.key;
      S.swipeDir = "l";
      S.g.row.style.transform = "";
      S.g.row.classList.remove("open", "open-r");
      S.g.row.classList.add("open");
    } else {
      S.g.row.style.transform = "";
      S.g.row.classList.remove("open", "open-r");
      if (S.swipeOpen === S.g.key) S.swipeOpen = null;
    }
  }
  S.g = null;
}
window.addEventListener("pointerup", () => endGesture(false));
window.addEventListener("pointercancel", () => endGesture(true));
document.addEventListener(
  "touchmove",
  (e) => {
    if (S.drag || S.reorder) e.preventDefault();
  },
  { passive: false },
);
document.addEventListener("contextmenu", (e) => {
  if (e.target.closest("[data-list-title], [data-hold]")) e.preventDefault();
});

// Keep receiving the pointer while rows move under it.
function capture(pid) {
  try {
    if (pid !== undefined && pid !== null) document.body.setPointerCapture(pid);
  } catch {
    /* not capturable */
  }
}

// Item move: press and hold a row. The held row stays in the page as a dashed slot and moves to where the item
// will land, as the held list does when reordering lists.
function startItemDrag(li, x, y, pid) {
  closeSwipe();
  if (!li.isConnected) return;
  const r = li.getBoundingClientRect();
  const ghost = li.cloneNode(true);
  ghost.classList.add("ghost");
  Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px` });
  document.body.appendChild(ghost);
  li.classList.add("dragging");
  capture(pid);
  S.suppressClick = true;
  navigator.vibrate?.(12);
  S.drag = { id: li.dataset.id, li, ghost, from: [li.parentNode, li.nextSibling], offY: y - r.top, lastY: y, lastX: x };
  S.drag.scrollTimer = setInterval(autoScroll, 16);
}
function autoScroll() {
  const sc = $("#scroll");
  if (!S.drag || !sc) return;
  const r = sc.getBoundingClientRect();
  if (S.drag.lastY < r.top + 60) sc.scrollTop -= 10;
  else if (S.drag.lastY > r.bottom - 60) sc.scrollTop += 10;
  else return;
  moveItemDrag(S.drag.lastX, S.drag.lastY);
}
function moveItemDrag(x, y) {
  S.drag.lastX = x;
  S.drag.lastY = y;
  S.drag.ghost.style.top = `${y - S.drag.offY}px`;
  const held = S.drag.li;
  const el = document.elementFromPoint(x, y);
  const sec = el?.closest("section[data-list]");
  if (!sec || el.closest("li.item") === held) return;
  for (const n of $$(".drop-into")) n.classList.remove("drop-into");
  const title = $(".list-title", sec);
  const ul = $(":scope > ul.items", sec);
  // A folded list, or one showing its removed items: the slot waits under the title and the item goes to the end
  if (!ul || $('[data-act="exit-removed"]', sec)) {
    if (title.nextElementSibling !== held) title.after(held);
    title.classList.add("drop-into");
    return;
  }
  const li = el.closest("li.item");
  let anchor;
  if (li && ul.contains(li)) {
    const r = li.getBoundingClientRect();
    anchor = y < r.top + r.height / 2 ? li : li.nextElementSibling;
  } else if (el.closest(".list-title")) anchor = ul.firstElementChild;
  else if (el.closest(".add-row, form.add, .hidden-note")) anchor = null;
  else return;
  if (anchor === held || (held.parentNode === ul && held.nextElementSibling === anchor)) return;
  ul.insertBefore(held, anchor);
}
function endItemDrag(cancelled) {
  clearInterval(S.drag.scrollTimer);
  S.drag.ghost.remove();
  for (const n of $$(".drop-into")) n.classList.remove("drop-into");
  const { id, li, from } = S.drag;
  S.drag = null;
  S.suppressClick = true;
  setTimeout(() => {
    S.suppressClick = false;
  }, 0);
  const it = getItem(id);
  const sec = li.closest("section[data-list]");
  const moved = li.parentNode !== from[0] || li.nextSibling !== from[1];
  if (cancelled || !moved || !it || !sec) {
    render();
    return;
  }
  // Placed after the row above it, or before the row below; ticked items hidden in between keep their places
  const inList = li.parentNode.matches("ul.items");
  const prev = inList && li.previousElementSibling;
  const next = inList && li.nextElementSibling;
  const where = prev ? { after: prev.dataset.id } : next ? { before: next.dataset.id } : {};
  save([L.moveItem(it, sec.dataset.list, itemsIn(sec.dataset.list), where, clock)]).then((changed) => {
    if (!changed.length) render();
  });
}

// List reorder: press and hold a title row. The lists fold with CSS and the held section moves in place, so the
// touched element stays in the page.
function beginReorder(k, y, pid) {
  if (!k || !getList(k)) return;
  capture(pid);
  closeSwipe();
  S.adding = null;
  const wrap = $(".lists");
  const held = $(`section[data-list="${k}"]`);
  if (!wrap || !held) return;
  wrap.classList.add("reordering");
  held.classList.add("held");
  S.suppressClick = true;
  navigator.vibrate?.(12);
  const app = $("#app").getBoundingClientRect();
  const gh = document.createElement("div");
  gh.className = "rghost";
  gh.innerHTML = `${svg("chevRight")}<span class="lname">${esc(getList(k).name)}</span>`;
  Object.assign(gh.style, { left: `${app.left + 6}px`, width: `${app.width - 12}px`, top: `${y - 26}px` });
  document.body.appendChild(gh);
  S.reorder = { id: k, wrap, held, ghost: gh, y };
  moveReorder(y);
}
function moveReorder(y) {
  S.reorder.y = y;
  S.reorder.ghost.style.top = `${y - 26}px`;
  const others = $$("section[data-list]", S.reorder.wrap).filter((s) => s.dataset.list && s !== S.reorder.held);
  let next = null;
  for (const s of others) {
    const b = s.getBoundingClientRect();
    if (b.top + b.height / 2 > y) {
      next = s;
      break;
    }
  }
  const anchor = next || $(".new-list", S.reorder.wrap) || null;
  if (S.reorder.held.nextElementSibling !== anchor) S.reorder.wrap.insertBefore(S.reorder.held, anchor);
  const sc = $("#scroll");
  if (sc) {
    const r = sc.getBoundingClientRect();
    if (y < r.top + 50) sc.scrollTop -= 8;
    else if (y > r.bottom - 50) sc.scrollTop += 8;
  }
}
function endReorder(cancelled) {
  const { id, wrap, ghost } = S.reorder;
  ghost.remove();
  S.reorder = null;
  S.suppressClick = true;
  setTimeout(() => {
    S.suppressClick = false;
  }, 0);
  const l = getList(id);
  if (cancelled || !l) {
    render();
    return;
  }
  const order = $$("section[data-list]", wrap)
    .map((s) => s.dataset.list)
    .filter(Boolean);
  const idx = order.indexOf(id);
  const others = activeLists().filter((x) => x.id !== id);
  const where = order[idx - 1] ? { after: order[idx - 1] } : order[idx + 1] ? { before: order[idx + 1] } : {};
  save([L.moveList(l, others, where, clock)]).then((changed) => {
    if (!changed.length) render();
  });
}
