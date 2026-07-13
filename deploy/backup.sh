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

docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env \
  exec -T postgres pg_dump -U postgres -Fc pushvault > "$BACKUP_DIR/pushvault-$STAMP.dump"

find "$BACKUP_DIR" -name 'pushvault-*.dump' -mtime +$KEEP_DAYS -delete
echo "[backup] $STAMP done → $BACKUP_DIR/pushvault-$STAMP.dump ($(du -h "$BACKUP_DIR/pushvault-$STAMP.dump" | cut -f1))"

# Optional off-site copy (recommended): install rclone, configure a remote
# (Backblaze B2 / S3 / Google Drive), then uncomment:
# rclone copy "$BACKUP_DIR/pushvault-$STAMP.dump" remote:pushvault-backups/

# Restore reference:
#   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env \
#     exec -T postgres pg_restore -U postgres -d pushvault --clean < backup.dump
