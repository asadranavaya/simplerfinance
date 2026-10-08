#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${BUDGET_APP_USER:-${SUDO_USER:-$USER}}"
NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"

if [[ ! -f "$APP_ROOT/.env" ]]; then
  echo "Missing .env. Run npm run setup first." >&2
  exit 1
fi
if [[ "$APP_USER" == "root" ]]; then
  echo "Refusing to run the application service as root. Invoke through sudo from the intended user or set BUDGET_APP_USER." >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  exec sudo --preserve-env=PATH bash "$0" "$@"
fi

install -d -o "$APP_USER" -g "$APP_USER" "$APP_ROOT/data" "$APP_ROOT/.secrets" "$APP_ROOT/backups"

cat > /etc/systemd/system/budget-app.service <<EOF
[Unit]
Description=SimplerFinance web service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_ROOT
Environment=NODE_ENV=production
ExecStart=$NODE_BIN server/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$APP_ROOT/data $APP_ROOT/.secrets $APP_ROOT/backups

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/budget-app-backup.service <<EOF
[Unit]
Description=Back up SimplerFinance SQLite database

[Service]
Type=oneshot
User=$APP_USER
WorkingDirectory=$APP_ROOT
ExecStart=$NPM_BIN run backup
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$APP_ROOT/data $APP_ROOT/.secrets $APP_ROOT/backups
EOF

cat > /etc/systemd/system/budget-app-backup.timer <<'EOF'
[Unit]
Description=Daily SimplerFinance backup

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true
RandomizedDelaySec=15m

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now budget-app.service budget-app-backup.timer
echo "Installed budget-app.service and daily backup timer."
