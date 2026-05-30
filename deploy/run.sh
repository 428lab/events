#!/usr/bin/env bash
# 本番起動スクリプト: ビルド済み成果物を本番モードで起動し、Cloudflare Tunnel を張る。
# リポジトリルートを cwd として実行すること。
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[deploy] building..."
pnpm -r build

echo "[deploy] starting server (NODE_ENV=production, :8080 / .env.production)"
NODE_ENV=production node apps/server/dist/index.js &
SERVER_PID=$!

cleanup() {
  echo "[deploy] stopping server ($SERVER_PID)"
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

# サーバーの起動を待つ（本番ポート 8080）
for i in $(seq 1 20); do
  if curl -sf http://localhost:8080/api/health >/dev/null; then break; fi
  sleep 0.5
done

echo "[deploy] starting cloudflared tunnel -> events.kojira.io"
cloudflared tunnel --config deploy/cloudflared.yml run events-kojira
