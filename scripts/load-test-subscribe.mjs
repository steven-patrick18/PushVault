/**
 * M5 acceptance: sustain 100 subscribe req/s. Each request uses a unique
 * X-Forwarded-For so per-IP rate limits (which are separately tested) don't
 * skew throughput numbers.
 *   node scripts/load-test-subscribe.mjs [rps=100] [seconds=10]
 */
import pg from "../apps/demo-site/node_modules/pg/lib/index.js";

const RPS = Number(process.argv[2] ?? 100);
const SECONDS = Number(process.argv[3] ?? 10);
const API = "http://localhost:3000/api/v1/public/subscribe";

const client = new pg.Client({
  connectionString: "postgres://postgres:postgres@localhost:5433/pushvault",
});
await client.connect();
const { rows } = await client.query("SELECT property_key FROM properties ORDER BY created_at ASC LIMIT 1");
await client.end();
const propertyKey = rows[0].property_key;

const latencies = [];
let ok = 0, failed = 0, throttled = 0;
const runId = Date.now();

async function fire(i) {
  const start = performance.now();
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:8080",
        "X-Forwarded-For": `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`,
      },
      body: JSON.stringify({
        property_key: propertyKey,
        subscription: {
          endpoint: `http://localhost:9999/push-sink/load-${runId}-${i}`,
          keys: { p256dh: "BLoadTestKey" + i, auth: "auth" + i },
        },
        utm: { source: "loadtest", campaign: "load_test" },
        landing_url: "http://localhost:8080/",
        tz: "Asia/Calcutta",
        lang: "en-US",
      }),
    });
    latencies.push(performance.now() - start);
    if (res.status === 201) ok++;
    else if (res.status === 429) throttled++;
    else failed++;
  } catch {
    latencies.push(performance.now() - start);
    failed++;
  }
}

console.log(`[load] ${RPS} req/s for ${SECONDS}s against ${API}`);
const t0 = performance.now();
const inflight = [];
for (let s = 0; s < SECONDS; s++) {
  const tickStart = performance.now();
  for (let r = 0; r < RPS; r++) inflight.push(fire(s * RPS + r));
  const elapsed = performance.now() - tickStart;
  if (elapsed < 1000) await new Promise((res) => setTimeout(res, 1000 - elapsed));
}
await Promise.all(inflight);
const wall = (performance.now() - t0) / 1000;

latencies.sort((a, b) => a - b);
const pct = (p) => latencies[Math.floor((latencies.length - 1) * p)].toFixed(0);
console.log(`[load] done in ${wall.toFixed(1)}s — effective ${(latencies.length / wall).toFixed(0)} req/s`);
console.log(`[load] 201 OK: ${ok}   429: ${throttled}   failed: ${failed}`);
console.log(`[load] latency ms — p50: ${pct(0.5)}  p95: ${pct(0.95)}  p99: ${pct(0.99)}  max: ${pct(1)}`);
process.exit(ok >= RPS * SECONDS * 0.98 ? 0 : 1);
