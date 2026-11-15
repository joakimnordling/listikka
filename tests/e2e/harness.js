// End-to-end harness: "devices" (separate browser contexts, each with its own IndexedDB and localStorage) running the
// built site (dist/site), as people use it. Build it first: npm run test:e2e does.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "../..");
const site = join(root, "dist", "site");

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

export async function startHarness({ args = [] } = {}) {
  const server = createServer(async (req, res) => {
    const rel = new URL(req.url, "http://x").pathname.slice(1) || "index.html";
    const file = resolve(site, rel);
    if (file.startsWith(site)) {
      try {
        const body = await readFile(file);
        return res
          .writeHead(200, { "content-type": types[file.slice(file.lastIndexOf("."))] || "application/octet-stream" })
          .end(body);
      } catch {}
    }
    res.writeHead(404).end();
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  // CHROMIUM_PATH: run with a Chromium other than the one this Playwright version downloads (local runs only)
  const browser = await chromium.launch({
    args,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  const errors = [];

  /** A new device: its own browser context, with the app loaded and ready. Script errors go to `errors`. */
  async function device({ viewport = { width: 393, height: 852 } } = {}) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: "block" });
    const pg = await ctx.newPage();
    pg.on("pageerror", (e) => errors.push(e.message));
    await pg.goto(`${base}/`);
    await ready(pg);
    return pg;
  }

  async function close() {
    await browser.close();
    server.close();
  }
  return { base, browser, errors, device, close };
}

// The app has loaded this device's copy
export const ready = (pg) => pg.waitForSelector("#scroll .lists");

// --- helpers used by several suites ---

const section = (key) => `section[data-list="${key}"]`;
export const row = (name) => `li.item:has(.n:text-is("${name}"))`;

/** Adds items to a list ("" for the unnamed list) by typing them, then closes the field. */
export async function addItems(pg, key, ...names) {
  await pg.click(`${section(key)} .add-row`);
  for (const n of names) {
    await pg.fill("#add-input", n);
    await pg.press("#add-input", "Enter");
  }
  await pg.press("#add-input", "Escape");
}

/** Creates a list from the header's menu and closes its add field; returns its key. */
export async function newList(pg, name) {
  await pg.click('[data-act="app-menu"]');
  await pg.click('.menu [data-act="new-list"]');
  await pg.fill("#f-lname", name);
  await pg.press("#f-lname", "Enter");
  await pg.waitForSelector("#add-input");
  await pg.press("#add-input", "Escape");
  return pg.$eval(`section:has(.lname:text-is("${name}"))`, (s) => s.dataset.list);
}

/** The names shown in a list, in order, as "name quantity". */
export const shown = (pg, key) =>
  pg.$$eval(`${section(key)} li.item .nq`, (els) => els.map((e) => e.textContent.trim()));

/** The stored item records, live ones only. */
export const items = (pg) => pg.evaluate(() => window.__listikka.store.items().filter((r) => !r.d));

/** Waits for a toast whose text matches, and returns its text. */
export const toastText = (pg, re) =>
  pg
    .waitForFunction((src) => new RegExp(src).test(document.querySelector(".toast")?.textContent || ""), re.source, {
      timeout: 30000,
    })
    .then(() => pg.textContent(".toast span"));

/** Drags a row sideways by dx pixels, as a swipe. */
export async function swipe(pg, selector, dx) {
  const b = await pg.locator(`${selector} .row`).boundingBox();
  const y = b.y + b.height / 2;
  const x = dx > 0 ? b.x + 100 : b.x + b.width - 40;
  await pg.mouse.move(x, y);
  await pg.mouse.down();
  await pg.mouse.move(x + dx, y + 2, { steps: 8 });
  await pg.mouse.up();
}

/** Holds an element for half a second, then drags it to (x, y). */
export async function holdAndDrag(pg, selector, to) {
  const b = await pg.locator(selector).first().boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await pg.mouse.move(x, y);
  await pg.mouse.down();
  await pg.waitForTimeout(600);
  await pg.mouse.move(to.x ?? x, to.y, { steps: 12 });
  await pg.mouse.up();
}

/** Opens Settings from the header's menu. */
export async function settings(pg) {
  await pg.click('[data-act="app-menu"]');
  await pg.click('[data-act="a-settings"]');
}
