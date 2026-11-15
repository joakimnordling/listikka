// Draws the PNG icons in public/icons from public/icons/listikka-icon.svg, with the browser Playwright installs,
// then compresses them losslessly (oxipng), as Lokki does with its screenshots.
//   npx playwright install chromium   (once)
//   npm run app-icons
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { losslessCompressPng } from "@napi-rs/image";
import { chromium } from "playwright";

const dir = resolve(import.meta.dirname, "..", "public", "icons");
const svg = await readFile(join(dir, "listikka-icon.svg"), "utf8");
const icons = [
  ["favicon-16.png", 16, 1],
  ["favicon-32.png", 32, 1],
  ["apple-touch-icon.png", 180, 1],
  ["icon-192.png", 192, 1],
  ["icon-512.png", 512, 1],
  // Maskable: the platform may cut the outer 10% away, so the berry sits smaller on the same background
  ["icon-maskable-512.png", 512, 0.8],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, scale] of icons) {
  await page.setViewportSize({ width: size, height: size });
  const inner = svg.replace(/<svg [^>]*>/, "").replace("</svg>", "");
  const bg = inner.match(/<rect [^>]*\/>/)[0];
  const art = inner.replace(bg, "");
  await page.setContent(
    `<style>html,body{margin:0}</style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">${bg}<g transform="translate(${256 * (1 - scale)} ${256 * (1 - scale)}) scale(${scale})">${art}</g></svg>`,
  );
  const png = await page.screenshot({ omitBackground: false });
  const small = await losslessCompressPng(png);
  await writeFile(join(dir, name), small);
  console.log(`${name}: ${png.length} -> ${small.length} bytes`);
}
await browser.close();
