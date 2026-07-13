# PushVault — Production Deployment (Hostinger VPS / any Ubuntu 24.04 box)

Everything runs on **one server** with Docker: Postgres 16 (tuned), Redis 7,
the API (which also serves the dashboard and the snippet CDN), and Caddy for
automatic HTTPS. Budget 30–45 minutes the first time.

> Sized for the 4–8 GB VPS tier (e.g. KVM-6GB). On a 4 GB box, halve
> `shared_buffers` / `effective_cache_size` in `docker-compose.prod.yml`.

---

## 1 · Order the server & point DNS

1. VPS with **Ubuntu 24.04 LTS, no control panel** (no cPanel/Plesk).
2. In your DNS (Hostinger → Domains → amanotelecom.com → DNS):
   add an **A record** → `push` → `YOUR.SERVER.IP` (TTL 300).
   The platform will live at `https://push.amanotelecom.com`.
   *Do this before first start — Caddy needs the DNS to issue the TLS cert.*

## 2 · Prepare the server

```bash
ssh root@YOUR.SERVER.IP

apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh

# firewall: SSH + web only
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
```

## 3 · Get the code

```bash
apt install -y git
git clone https://github.com/steven-patrick18/PushVault.git
cd PushVault
```
*(Private repo? Create a GitHub fine-grained PAT with repo read access and use
`https://TOKEN@github.com/steven-patrick18/PushVault.git`, or add a deploy key.)*

## 4 · Configure

```bash
cp deploy/.env.production.example deploy/.env
nano deploy/.env
```

- `PUSH_DOMAIN` — the subdomain from step 1.
- Three secrets — generate each with `openssl rand -base64 32`.
- VAPID keys — generate **once** and never change after collecting subscribers:
  ```bash
  docker run --rm node:22-bookworm-slim npx web-push generate-vapid-keys
  ```
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — your dashboard login.

## 5 · Launch

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
# first build takes ~5 min; watch it:
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env logs -f api
```

When the log shows `PushVault API listening`, create the admin:

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env \
  exec api node scripts/seed-prod.mjs
```

Open **https://push.amanotelecom.com** → log in. Done.

## 6 · Backups (do this on day one)

```bash
chmod +x deploy/backup.sh
crontab -e   # add:
# 15 2 * * * /root/PushVault/deploy/backup.sh >> /var/log/pushvault-backup.log 2>&1
```
Dumps land in `/var/backups/pushvault` (14-day retention). For off-site
copies, configure `rclone` and uncomment the line in `backup.sh`.

## 7 · Optional: GeoLite2 (country/city on leads)

1. Free account at maxmind.com → download **GeoLite2-City.mmdb**.
2. `mkdir -p deploy/geoip` and upload the file there
   (`scp GeoLite2-City.mmdb root@IP:/root/PushVault/deploy/geoip/`).
3. In `deploy/.env`: `GEOIP_DB_PATH=/geoip/GeoLite2-City.mmdb`
4. `docker compose ... up -d api` to restart.

## 8 · Connect your first website

1. Dashboard → Properties → the property's **Install & verify** section.
2. Upload `pv-sw.js` (from `https://PUSH_DOMAIN/cdn/pv-sw.js`) to the website's
   root folder (Hostinger File Manager → `public_html`).
3. Add the snippet before `</body>` (it now points at your real domain).
4. Click **Verify installation** → green.

## 9 · Updating PushVault

```bash
cd /root/PushVault
git pull
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
```
The dashboard's **Updates** page shows what's new; migrations run
automatically on start. Blasts interrupted by the restart resume themselves.

## Operations cheat-sheet

| Task | Command (prefix: `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env`) |
|---|---|
| Status / health | `ps` |
| API logs | `logs -f api` |
| Restart API only | `restart api` |
| Postgres shell | `exec postgres psql -U postgres pushvault` |
| Manual backup | `deploy/backup.sh` |
| Stop everything | `down` (data persists in volumes) |

## Scale-out later (the BullMQ step)

The engine is DB-backed and restart-safe on one node. When one server stops
being enough (≈ millions of subscribers or multi-node HA):
1. Move Postgres to a managed service.
2. Swap `TaskPool` in `apps/api/src/modules/campaigns/campaign-runner.service.ts`
   for BullMQ workers on `push-send:{tenantId}` queues (Redis is already in the
   stack; the per-tenant pool layout maps 1:1 to queue names).
3. Run N `api` replicas behind Caddy.
