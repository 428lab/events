#!/usr/bin/env bash
# 開発ツリー(develop/eventer)の最新ソースを本番ツリー(develop/eventer-prod)へ反映し、
# 本番を再ビルド＆再起動する。本番の .env.production と data/（DB）は除外＝保持される。
set -euo pipefail

# 開発ツリー = このスクリプトの 1つ上（deploy/ の親）。本番ツリーは既定で <dev>-prod。
# 別の場所にしたい場合は環境変数 EVENTER_PROD で上書き。
DEV="$(cd "$(dirname "$0")/.." && pwd)"
PROD="${EVENTER_PROD:-${DEV}-prod}"

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
# LISTEN しているサーバープロセスのみ対象（cloudflared の :8080 への接続を拾わない）
for PID in $(lsof -ti:8080 -sTCP:LISTEN 2>/dev/null); do kill "$PID"; done
sleep 1
NODE_ENV=production node apps/server/dist/index.js > /tmp/eventer-prod.log 2>&1 &

# 起動待ち
for i in $(seq 1 20); do
  if curl -sf http://localhost:8080/api/health >/dev/null; then break; fi
  sleep 0.5
done
echo "[redeploy] done. health:"
curl -s http://localhost:8080/api/health; echo ""
echo "[redeploy] 注意: トンネルが未起動なら別途 'pnpm tunnel' を実行してください。"
