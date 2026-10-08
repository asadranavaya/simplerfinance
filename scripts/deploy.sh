#!/bin/bash
set -e

echo "→ Building frontend..."
npm run build --prefix renderer

echo "→ Restarting server..."
pm2 restart budget-api

echo "✅ Deploy complete"
