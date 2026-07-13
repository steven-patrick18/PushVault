/**
 * Builds the snippet + service worker and copies them to:
 *  - apps/api/public/        (served at /cdn/* — local CDN stand-in)
 *  - apps/demo-site/public/  (pv-sw.js must live at the site root)
 */
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const APP_BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";

mkdirSync(resolve(here, "dist"), { recursive: true });

// 1. snippet
await build({
  entryPoints: [resolve(here, "src/pushvault.ts")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2017",
  outfile: resolve(here, "dist/pushvault.js"),
  define: { __APP_BASE__: JSON.stringify(APP_BASE) },
});

// 2. service worker (plain JS, just replace the base URL token)
const sw = readFileSync(resolve(here, "src/pv-sw.js"), "utf8").replaceAll(
  "__APP_BASE__",
  APP_BASE,
);
writeFileSync(resolve(here, "dist/pv-sw.js"), sw);

// 3. copy to API public dir (local CDN) and demo site root
const apiPublic = resolve(here, "../api/public");
const demoPublic = resolve(here, "../demo-site/public");
mkdirSync(apiPublic, { recursive: true });
mkdirSync(demoPublic, { recursive: true });
copyFileSync(resolve(here, "dist/pushvault.js"), resolve(apiPublic, "pushvault.js"));
copyFileSync(resolve(here, "dist/pv-sw.js"), resolve(apiPublic, "pv-sw.js"));
copyFileSync(resolve(here, "dist/pv-sw.js"), resolve(demoPublic, "pv-sw.js"));

const raw = readFileSync(resolve(here, "dist/pushvault.js"));
const gz = gzipSync(raw).length;
console.log(`[snippet] pushvault.js ${raw.length} bytes raw, ${gz} bytes gzipped (budget: 15360)`);
if (gz > 15360) {
  console.error("[snippet] OVER BUDGET");
  process.exit(1);
}
