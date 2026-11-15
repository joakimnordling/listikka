// The on-screen keyboard. iOS lays it over the bottom of the page instead of shrinking the page, and
// doesn't always scroll the field being typed in above it. Its height is kept in the CSS variable --kb,
// so the app and sheets can end above it, and keepInView() brings a field back into sight.

/** How much of the page the keyboard covers at the bottom, in CSS pixels. */
export function keyboardInset() {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
}

/** Keeps --kb up to date, and calls onChange after each change. */
export function watchKeyboard(onChange) {
  const vv = window.visualViewport;
  if (!vv) return;
  let last = -1;
  const update = () => {
    const kb = keyboardInset();
    if (kb === last) return;
    last = kb;
    document.documentElement.style.setProperty("--kb", `${kb}px`);
    onChange();
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}

/** Scrolls el's scrolling container just enough to show all of el. */
export function keepInView(el) {
  el?.scrollIntoView({ block: "nearest" });
}
