/**
 * Demo store: a fake shop with the PushVault snippet installed, on
 * http://localhost:8080 (localhost is a secure context, so web push works).
 * Looks up the demo property key straight from the dev database.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8080;

const { Client } = pg;
const client = new Client({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/pushvault",
});
await client.connect();
const { rows } = await client.query(
  "SELECT property_key FROM properties ORDER BY created_at ASC LIMIT 1",
);
await client.end();
const propertyKey = rows[0]?.property_key;
if (!propertyKey) {
  console.error("[demo-site] no property found — run `pnpm seed` first");
  process.exit(1);
}
console.log("[demo-site] using property key", propertyKey);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = createServer((req, res) => {
  const path = req.url.split("?")[0];
  let file = path === "/" ? "index.html" : path.slice(1);
  try {
    const full = resolve(join(here, "public", file));
    if (!full.startsWith(resolve(join(here, "public")))) throw new Error("traversal");
    let body = readFileSync(full);
    if (file.endsWith(".html")) {
      body = Buffer.from(body.toString("utf8").replaceAll("%PROPERTY_KEY%", propertyKey));
    }
    res.writeHead(200, { "Content-Type": MIME[extname(full)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`[demo-site] Demo store on http://localhost:${PORT}`);
});
