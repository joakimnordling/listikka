/* A group's name and picture, both from its look key (keys.js), so every device shows the same ones without
   anything being sent. Part of the format: listikka/group/v1/look.

   Name: the adjective picked by byte 16 and the animal picked by byte 17 (words.js), each capitalised: "Amber Otter".
   Picture: a mirrored 5×5 pattern on a 7×7 grid with a one-cell margin. Cell (x, y), for x 0 to 2 and y 0 to 4, is
   filled when byte 1 + 3y + x is odd; columns 3 and 4 mirror columns 1 and 0. The hue is byte 0 × 360 / 255,
   rounded: the background hsl(hue 55% 88%), the cells hsl(hue 60% 38%), in a square whose corners are rounded by a
   fifth of its side. The same in every theme. */
import { ADJECTIVES, ANIMALS } from "./words.js";

const cap = (w) => w[0].toUpperCase() + w.slice(1);

/** The group's name: "Amber Otter". */
export const groupName = (look) => `${cap(ADJECTIVES[look[16]])} ${cap(ANIMALS[look[17]])}`;

/** The filled cells, as [x, y] on the 5×5 pattern. */
export function groupCells(look) {
  const cells = [];
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 3; x++)
      if (look[1 + 3 * y + x] & 1) {
        cells.push([x, y]);
        if (x < 2) cells.push([4 - x, y]);
      }
  return cells;
}

export const groupHue = (look) => Math.round((look[0] * 360) / 255);

/** The group's picture as SVG markup, `size` pixels square. */
export function groupPicture(look, size = 28) {
  const hue = groupHue(look);
  const rects = groupCells(look)
    .map(([x, y]) => `<rect x="${x + 1}" y="${y + 1}" width="1" height="1"/>`)
    .join("");
  return `<svg class="group-pic" width="${size}" height="${size}" viewBox="0 0 7 7" aria-hidden="true"><rect width="7" height="7" rx="1.4" fill="hsl(${hue} 55% 88%)"/><g fill="hsl(${hue} 60% 38%)">${rects}</g></svg>`;
}
