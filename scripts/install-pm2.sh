#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_ROOT"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "PM2 is not installed. Install it with: npm install --global pm2" >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  echo "Missing .env. Run npm run setup first." >&2
  exit 1
fi

npm ci
npm ci --prefix renderer
npm test
npm run build
pm2 startOrReload ecosystem.config.js --update-env

if ! pm2 describe budget-backup >/dev/null 2>&1; then
  pm2 start scripts/backup-db.js --name budget-backup --cron-restart "0 2 * * *" --no-autorestart
fi
pm2 save

echo "PM2 application and daily 02:00 backup schedule installed."
echo "Run the command printed by 'pm2 startup' once if startup persistence is not configured."
