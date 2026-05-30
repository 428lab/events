#!/usr/bin/env bash
# 開発ツリー(develop/eventer)の最新ソースを本番ツリー(develop/eventer-prod)へ反映し、
# 本番を再ビルド＆再起動する。本番の .env.production と data/（DB）は除外＝保持される。
set -euo pipefail

DEV=/Users/kojira/develop/eventer
PROD=/Users/kojira/develop/eventer-prod

echo "[redeploy] syncing source $DEV -> $PROD"
rsync -a \
  --exclude='node_modules' --exclude='dist' --exclude='data' \
  --exclude='.git' --exclude='.env' --exclude='.env.production' \
  --exclude='*.log' \
  "$DEV/" "$PROD/"

cd "$PROD"
echo "[redeploy] install & build"
pnpm install
pnpm -r build

echo "[redeploy] restarting prod server on :8080"
PID=$(lsof -ti:8080 2>/dev/null || true)
if [ -n "$PID" ]; then kill "$PID"; sleep 1; fi
NODE_ENV=production node apps/server/dist/index.js > /tmp/eventer-prod.log 2>&1 &

# 起動待ち
for i in $(seq 1 20); do
  if curl -sf http://localhost:8080/api/health >/dev/null; then break; fi
  sleep 0.5
done
echo "[redeploy] done. health:"
curl -s http://localhost:8080/api/health; echo ""
echo "[redeploy] 注意: トンネルが未起動なら別途 'pnpm tunnel' を実行してください。"
