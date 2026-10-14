#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

command -v node >/dev/null
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
if [[ ! -f .env ]]; then cp .env.example .env; fi
npm ci --cache "${OYLA_NPM_CACHE:-/workspace/.npm-cache}"
if [[ "${SKIP_LOCAL_DB:-0}" != 1 ]]; then
  docker compose up -d db
  ready=0
  for attempt in {1..30}; do
    if docker compose exec -T db pg_isready -U "${POSTGRES_USER:-oylatap}" -d "${POSTGRES_DB:-oylatap}" >/dev/null 2>&1; then
      ready=1; break
    fi
    sleep 1
  done
  if [[ "$ready" != 1 ]]; then echo "PostgreSQL did not become ready" >&2; exit 1; fi
fi
npm run db:migrate
if node --input-type=module -e "import 'dotenv/config'; process.exit(process.env.DEMO_MODE === 'true' ? 0 : 1)"; then
  npm run db:seed
fi
npm run build
