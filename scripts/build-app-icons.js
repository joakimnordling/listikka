// Draws the PNG icons in public/icons with the browser Playwright installs, then compresses them losslessly (oxipng),
// as Lokki does with its screenshots:
// - from listikka-icon.svg, square: the app icons, which iOS, Android and desktops round or mask themselves
// - from favicon.svg, with rounded corners on a transparent background: the browser tab's icons
// The maskable icon (Android) draws the berry smaller, so it stays inside the circle a launcher may crop it to.
//   npx playwright install chromium   (once)
//   npm run app-icons
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { losslessCompressPng } from "@napi-rs/image";
import { chromium } from "playwright";

const dir = resolve(import.meta.dirname, "..", "public", "icons");
const icon = await readFile(join(dir, "listikka-icon.svg"), "utf8");
const favicon = await readFile(join(dir, "favicon.svg"), "utf8");
const maskable = icon.replace(/translate\([^)]*\) scale\([^)]*\)/, "translate(80 92.8) scale(3.2)");

const outputs = [
  ["icon-512.png", icon, 512],
  ["icon-192.png", icon, 192],
  ["apple-touch-icon.png", icon, 180],
  ["icon-maskable-512.png", maskable, 512],
  ["favicon-32.png", favicon, 32, true],
  ["favicon-16.png", favicon, 16, true],
];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const [name, svg, size, transparent] of outputs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const sized = svg.replace(/<svg ([^>]*?)>/, `<svg $1 width="${size}" height="${size}">`);
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${sized}`);
  const png = await page.screenshot({ omitBackground: !!transparent });
  const small = await losslessCompressPng(png);
  await writeFile(join(dir, name), small);
  await page.close();
  console.log(`${name} (${size}×${size}): ${small.length} bytes`);
}
await browser.close();
