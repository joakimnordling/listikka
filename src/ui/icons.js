// The icons Listikka uses, by role. The markup comes from Lucide via the generated lucide.js (npm run icons).
import { LUCIDE } from "./lucide.js";

export const ICON_NAMES = {
  more: "ellipsis",
  cog: "settings",
  back: "arrow-left",
  chevDown: "chevron-down",
  chevRight: "chevron-right",
  x: "x",
  list: "list",
  plus: "plus",
  check: "check",
  square: "square",
  eye: "eye",
  eyeOff: "eye-off",
  pencil: "pencil",
  broom: "broom",
  broomSparkles: "broom-sparkles",
  undo: "undo-2",
  trash: "trash-2",
  server: "server",
  refresh: "refresh-cw",
  scan: "scan-line",
  download: "download",
  upload: "upload",
};

// A complete <svg> for an icon role, hidden from screen readers: the button or text next to it says what it is.
export const svg = (role, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LUCIDE[ICON_NAMES[role]]}</svg>`;
