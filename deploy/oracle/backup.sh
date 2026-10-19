#!/usr/bin/env bash
set -euo pipefail
cd /opt/oylatap/app
exec 9>/opt/oylatap/backup.lock
flock -n 9 || exit 0
compose=(docker compose --env-file deploy/oracle/.env -f deploy/oracle/compose.yaml)
target="/app/backups/$(date -u +%Y%m%dT%H%M%SZ)"
# Stop filesystem writers as well as database writes before taking the snapshot.
trap '"${compose[@]}" up -d web' EXIT
"${compose[@]}" stop web
"${compose[@]}" run --rm --no-deps web node scripts/backup.mjs --output "$target"
"${compose[@]}" run --rm --no-deps web node scripts/restore.mjs --backup "$target" --verify
echo "Verified backup: $target"
