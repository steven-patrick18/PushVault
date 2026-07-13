# PushVault

Multi-tenant web push notification platform. Client sites install a JS snippet + service worker; visitors opt in via a compliant two-step prompt; operators segment subscribers and send push campaigns with full analytics.

## Stack

- **API** — Node 20+ / NestJS / TypeScript ([apps/api](apps/api))
- **DB** — PostgreSQL with Row-Level Security tenant isolation, Prisma ORM
- **Dashboard** — React + Vite ([apps/dashboard](apps/dashboard))
- **Queue** — Redis + BullMQ (arrives with M3)

## Local development (no Docker required)

```bash
pnpm install
pnpm dev:db          # starts embedded PostgreSQL on :5433 (keep running)
pnpm migrate         # apply migrations (first run only)
pnpm seed            # demo tenant + admin + property (first run only)
pnpm dev:api         # NestJS API on :3000
pnpm dev:dashboard   # dashboard on :5173
```

Login: `admin@pushvault.local` / `admin123`

Copy `apps/api/.env.example` to `apps/api/.env` before first run.

## Verify tenant isolation (M1 acceptance)

```bash
pnpm test:rls
```

Proves via the restricted `pv_app` role that a tenant cannot read, update, or insert another tenant's rows — even with crafted raw SQL.

## Milestones

- [x] **M1** — Foundation: schema + RLS + auth + properties (RLS test 6/6)
- [x] **M2** — Capture: snippet (≈3 KB gz) + service worker + subscribe API + demo store
- [x] **M3** — Send engine: per-tenant queues, frequency caps, 410 pruning, 429 backoff, pacing
- [x] **M4** — Dashboard v1: subscribers, segments, campaign manager with platform previews, property manager (verify + page allow/block + prompt designer), settings
- [x] **M5** — Hardening: rate limits (subscribe 10/min/IP/property, login 5/min/IP), audit log + viewer, GDPR erasure, maintenance jobs (segment cache, stuck-campaign finalizer, 90d send retention), load test 100 req/s sustained (p50 76 ms)
- [x] **Phase 2** — Recurring campaigns (daily/weekly/monthly, cloned occurrences), client portal role (read-only, property-scoped), WordPress/Shopify/HTML install guides, exit-intent trigger, growth analytics
- [x] **Phase 3** — Drip automations (DB-backed scheduler, welcome series on subscribe), A/B testing (50/50 split, per-variant CTR + winner), revenue attribution (pv_sid click handoff → `PushVault.trackConversion` pixel + X-Api-Key webhook), per-property VAPID keys, plans/quotas with usage metering (Stripe checkout stubbed — set STRIPE_SECRET_KEY)

**Deliberately deferred:** ClickHouse event store (Postgres is fine below ~10M sends/mo; swap point is the `sends` table) and live Stripe checkout (needs account keys; quota enforcement is active regardless).

## Production notes

- **Redis/BullMQ**: the send engine uses in-process per-tenant pools mirroring the
  `push-send:{tenantId}` queue layout; swap in BullMQ workers when Redis is available.
- **Partitioning**: `sends` should be partitioned monthly by `sent_at` in production —
  native SQL (`PARTITION BY RANGE`), applied at deploy time; Prisma does not manage partitions.
- **Rate limiting**: in-memory sliding window per process; back with Redis when running replicas.
- **GeoIP**: set `GEOIP_DB_PATH` to a MaxMind GeoLite2-City `.mmdb` to enable geo capture.
- Passwords/API keys hashed with scrypt (Node built-in); switch to argon2id if a native
  dependency is acceptable.
