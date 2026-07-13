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

- [x] **M1** — Foundation: schema + RLS + auth + properties
- [ ] **M2** — Capture: snippet + service worker + subscribe API
- [ ] **M3** — Send engine: BullMQ queues, frequency caps, token pruning
- [ ] **M4** — Dashboard v1: subscribers, segments, campaign composer + reports
- [ ] **M5** — Hardening: rate limits, audit log, erasure, load tests
