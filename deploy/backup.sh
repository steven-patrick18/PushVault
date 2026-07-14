#!/usr/bin/env bash
# Nightly PostgreSQL backup — keeps 14 days locally.
# Install:  chmod +x deploy/backup.sh
#           crontab -e  →  15 2 * * * /root/PushVault/deploy/backup.sh >> /var/log/pushvault-backup.log 2>&1
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pushvault}"
STAMP="$(date +%Y%m%d-%H%M%S)"
KEEP_DAYS=14

mkdir -p "$BACKUP_DIR"
cd "$REPO_DIR"

TMP="$BACKUP_DIR/.pushvault-$STAMP.dump.partial"
FINAL="$BACKUP_DIR/pushvault-$STAMP.dump"

# dump to a temp file first so a mid-stream failure never overwrites/creates a
# file that looks like a good backup
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env \
  exec -T postgres pg_dump -U postgres -Fc pushvault > "$TMP"

# verify the dump is non-empty and structurally valid before trusting it
if [ ! -s "$TMP" ]; then
  echo "[backup] FAILED — dump is empty" >&2
  rm -f "$TMP"
  exit 1
fi
if ! docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env \
  exec -T postgres pg_restore --list /dev/stdin < "$TMP" > /dev/null 2>&1; then
  echo "[backup] FAILED — dump did not validate (pg_restore --list)" >&2
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$FINAL"
# only prune old backups AFTER a verified new one exists
find "$BACKUP_DIR" -name 'pushvault-*.dump' -mtime +$KEEP_DAYS -delete
echo "[backup] $STAMP done → $FINAL ($(du -h "$FINAL" | cut -f1))"

# Off-site copy — STRONGLY recommended (a dead VPS disk loses primary + backup
# together). Install rclone, configure a remote (Backblaze B2 / S3), then set
# BACKUP_REMOTE, e.g. BACKUP_REMOTE=b2:pushvault-backups
if [ -n "${BACKUP_REMOTE:-}" ]; then
  rclone copy "$FINAL" "$BACKUP_REMOTE/" && echo "[backup] off-site copy → $BACKUP_REMOTE"
else
  echo "[backup] WARNING: no off-site copy (set BACKUP_REMOTE for disaster safety)" >&2
fi

# Restore reference:
#   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env \
#     exec -T postgres pg_restore -U postgres -d pushvault --clean < backup.dump
