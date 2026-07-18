#!/usr/bin/env bash
# Monthly refresh of the free DB-IP Lite databases used by GeoService:
#   - country  -> deploy/geoip/geoip.mmdb  (audience country targeting)
#   - ASN      -> deploy/geoip/asn.mmdb    (datacenter/cloud/VPN blocking)
# DB-IP publishes a new file on the 1st of each month (CC-BY, no account). The
# API auto-reloads a reader when its mmdb file's mtime changes, so NO restart is
# needed — this script just swaps the files atomically.
#
# Install (one-time, on the server):
#   chmod +x /root/PushVault/deploy/geoip-refresh.sh
#   ( crontab -l 2>/dev/null; echo "30 4 3 * * /root/PushVault/deploy/geoip-refresh.sh >> /root/pushvault-geoip.log 2>&1" ) | crontab -
set -uo pipefail

REPO="${PUSHVAULT_REPO:-/root/PushVault}"
GEO="$REPO/deploy/geoip"
mkdir -p "$GEO"

now="$(date -u +%FT%TZ)"
CUR="$(date -u +%Y-%m)"
PREV="$(date -u -d "$(date -u +%Y-%m-01) -1 month" +%Y-%m)"

# fetch <kind> <destfile> ; tries current month then previous month
fetch() {
  local kind="$1" dest="$2" ym url tmp
  for ym in "$CUR" "$PREV"; do
    url="https://download.db-ip.com/free/dbip-${kind}-lite-${ym}.mmdb.gz"
    tmp="$(mktemp "${dest}.XXXXXX")"
    if curl -fsSL --max-time 120 -o "$tmp.gz" "$url" && gunzip -f "$tmp.gz"; then
      # sanity: a real db is well over 1 MB; reject truncated/HTML error pages
      if [ "$(stat -c%s "$tmp" 2>/dev/null || echo 0)" -gt 1000000 ]; then
        mv -f "$tmp" "$dest"          # atomic swap (same filesystem)
        echo "$now  ${kind}: updated from ${ym} -> $dest ($(stat -c%s "$dest") bytes)"
        return 0
      fi
    fi
    rm -f "$tmp" "$tmp.gz" 2>/dev/null
  done
  echo "$now  ${kind}: FAILED (tried $CUR, $PREV) — keeping existing file"
  return 1
}

fetch country "$GEO/geoip.mmdb"
fetch asn     "$GEO/asn.mmdb"
