// A tiny static server for trying the built site: npm run build, then npm run serve (http://localhost:8080).
//   PORT=3000 npm run serve
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const dir = resolve(import.meta.dirname, "..", "dist", "site");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
  let file = normalize(join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!file.startsWith(dir)) return res.writeHead(403).end();
  const s = await stat(file).catch(() => null);
  if (s?.isDirectory()) file = join(file, "index.html");
  if (!(await stat(file).catch(() => null))?.isFile()) return res.writeHead(404).end("Not found");
  res.writeHead(200, {
    "Content-Type": types[extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(res);
}).listen(Number(process.env.PORT) || 8080, () => console.log(`http://localhost:${Number(process.env.PORT) || 8080}`));
