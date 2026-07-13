/**
 * Fake push service for send-engine testing. Synthetic subscriber endpoints
 * point here; responses are deterministic per endpoint so retries make sense:
 *   ~80% -> 201 (accepted), ~15% -> 410 (dead token), ~5% -> 429 (rate limited)
 */
import { createServer } from "node:http";

let hits = 0;
const server = createServer((req, res) => {
  hits++;
  const hash = [...req.url].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0);
  const bucket = hash % 100;
  if (bucket < 80) {
    res.writeHead(201);
  } else if (bucket < 95) {
    res.writeHead(410);
  } else {
    res.writeHead(429, { "Retry-After": "1" });
  }
  res.end();
  if (hits % 200 === 0) console.log(`[push-sink] ${hits} requests handled`);
});

server.listen(9999, () => console.log("[push-sink] listening on :9999"));
