// The README's screenshots, in the default theme: the built site with a fixed set of lists, photographed at a
// phone's size, then losslessly compressed (oxipng). As Lokki's scripts/screenshots.js.
// Run with: npm run screenshots          (writes docs/screenshots/*.png)
// The same records every time, so the images only change when the app's looks do.
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { losslessCompressPng } from "@napi-rs/image";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const site = join(root, "dist", "site");
const out = join(root, "docs", "screenshots");

// The lists, as records (src/core/records.js). Names that read the same anywhere; ✓ = ticked, ✕ = removed.
const LISTS = [
  ["Supermarket", ["Milk|2 l", "Eggs|10", "✓Bread", "✓Bananas", "Tomatoes|500 g", "✓Cheese", "Cornflakes", "✕Coffee"]],
  ["Pharmacy", ["✓Plasters", "Sunscreen", "Vitamin D"]],
  ["Hardware store", ["Light bulbs", "AA batteries"]],
];
const T = Date.UTC(2026, 10, 15, 12);
function records() {
  const ts = (fields) => Object.fromEntries(fields.map((f) => [f, T]));
  const recs = [];
  LISTS.forEach(([name, items], n) => {
    const list = `list-${n}`;
    recs.push({ kind: "list", id: list, name, s: "active", o: `a${n}`, ts: ts(["name", "s", "o"]) });
    items.forEach((spec, i) => {
      const s = spec.startsWith("✓") ? "done" : spec.startsWith("✕") ? "hidden" : "todo";
      const [itemName, q] = spec.replace(/^[✓✕]/, "").split("|");
      const item = { kind: "item", id: `${list}-${i}`, list, name: itemName, s, o: `a${i}` };
      if (q) item.q = q;
      recs.push({ ...item, ts: ts(Object.keys(item).filter((f) => !["kind", "id"].includes(f))) });
    });
  });
  return recs;
}
const section = (name) => `section:has(.lname:text-is("${name}"))`;

// Each screenshot: its name, and how to get there from the lists
const SHOTS = [
  ["lists", async () => {}],
  // a removed item offered back while typing
  [
    "adding",
    async (pg) => {
      await pg.click(`${section("Supermarket")} .add-row`);
      await pg.type("#add-input", "Co");
      await pg.waitForSelector("#sugg .sg");
    },
  ],
  [
    "item",
    async (pg) => {
      await pg.click('li.item:has(.n:text-is("Milk")) [data-act="edit"]');
      await pg.fill("#f-note", "Lactose free");
      await pg.click(".sheet h2"); // out of the field, without its focus ring
    },
  ],
];

// The built site, served from a local port
function serve() {
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
  };
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(site, path);
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

execFileSync(process.execPath, [join(root, "scripts", "build-site.js")], { stdio: "ignore" });
const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/`;
await mkdir(out, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  for (const [name, go] of SHOTS) {
    const context = await browser.newContext({
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: "en-US",
      timezoneId: "Europe/Helsinki",
      serviceWorkers: "block",
    });
    const pg = await context.newPage();
    await pg.goto(url);
    await pg.waitForFunction(() => window.__listikka?.store);
    await pg.evaluate((recs) => window.__listikka.store.change(recs), records());
    await go(pg);
    await pg.waitForTimeout(400); // sheets and toasts settle
    const png = await pg.screenshot();
    const small = await losslessCompressPng(png);
    await writeFile(join(out, `${name}.png`), small);
    console.log(`${name}.png: ${Math.round(png.length / 1024)} → ${Math.round(small.length / 1024)} KB`);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
