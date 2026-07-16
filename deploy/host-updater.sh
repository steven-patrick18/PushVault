#!/usr/bin/env bash
# PushVault self-update watcher (runs on the HOST via cron, as the deploy user).
# When the app's "Update now" button drops control/update.request, this pulls
# the latest code and rebuilds the stack, writing progress to control/update.status
# so the dashboard can show it. The container never touches Docker directly.
#
# Install (one-time, on the server):
#   chmod +x /root/PushVault/deploy/host-updater.sh
#   ( crontab -l 2>/dev/null; echo "* * * * * /root/PushVault/deploy/host-updater.sh >> /root/pushvault-update.log 2>&1" ) | crontab -
set -euo pipefail

REPO="${PUSHVAULT_REPO:-/root/PushVault}"
CONTROL="$REPO/control"
REQ="$CONTROL/update.request"
STATUS="$CONTROL/update.status"
LOCK="$CONTROL/update.lock"
COMPOSE="docker compose -f $REPO/deploy/docker-compose.prod.yml --env-file $REPO/deploy/.env"

mkdir -p "$CONTROL"
# the container writes as uid 1000 (node); make sure it can
chown -R 1000:1000 "$CONTROL" 2>/dev/null || true

[ -f "$REQ" ] || exit 0                 # nothing requested
# single-flight: skip if an update is already running
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

status() { echo "{\"state\":\"$1\",\"at\":\"$(date -u +%FT%TZ)\",\"detail\":\"${2:-}\"}" > "$STATUS"; chown 1000:1000 "$STATUS" 2>/dev/null || true; }

rm -f "$REQ"
status "pulling" "fetching latest code"
cd "$REPO"
git fetch --quiet origin
git reset --hard "origin/$(git rev-parse --abbrev-ref HEAD)"

status "building" "rebuilding and restarting (this can take a few minutes)"
export GIT_SHA="$(git rev-parse HEAD)"
if $COMPOSE up -d --build; then
  status "done" "updated to ${GIT_SHA:0:7}"
else
  status "failed" "build failed — previous version still running"
fi
