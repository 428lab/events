#!/usr/bin/env bash
# ステージング・本番への push で、同じコミットが main で CI を通っているかを確かめる。
#
#   main-ci-gate.sh <owner/repo> <sha>
#
# 結果は `tested=true|false` を $GITHUB_OUTPUT（無ければ標準出力）に書く。
#   true  … このコミットは main への push の CI（ci.yml）で成功している → テストを流し直さない
#   false … 見つからない・失敗した・待ちきれなかった・API が使えなかった → 今までどおり全部のテストを流す
# このスクリプトは「流し直さなくてよい」と言えるときだけ true を返し、迷ったら必ず false に倒す。
# deploy はテストの成功か tested=true のどちらかが無ければ走らないので、テストしていないコミットは出ない。
#
# main の CI がまだ動いている（マージ直後にステージングへ push したとき）は、終わるまで待つ。
#   GATE_TIMEOUT_SEC（既定 1500 = 25分）・GATE_POLL_SEC（既定 20）
# 呼び出しには GH_TOKEN（actions: read）が要る。
set -euo pipefail

repo="${1:?usage: main-ci-gate.sh <owner/repo> <sha>}"
sha="${2:?usage: main-ci-gate.sh <owner/repo> <sha>}"
timeout="${GATE_TIMEOUT_SEC:-1500}"
interval="${GATE_POLL_SEC:-20}"
out="${GITHUB_OUTPUT:-/dev/stdout}"
deadline=$(( $(date +%s) + timeout ))

decide() { echo "tested=$1" >> "$out"; exit 0; }

while :; do
  if ! runs=$(gh api "repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&branch=main&event=push&per_page=20" \
      --jq '[.workflow_runs[] | {id, status, conclusion}]' 2>/dev/null); then
    echo "gate: GitHub API に問い合わせられなかった → 全部のテストを流す"
    decide false
  fi

  ok=$(jq -r '[.[] | select(.conclusion == "success") | .id] | first // empty' <<<"$runs")
  if [[ -n "$ok" ]]; then
    echo "gate: ${sha} は main の CI（run ${ok}）で成功済み → テストを流し直さない"
    decide true
  fi

  if jq -e 'any(.[]; .status != "completed")' <<<"$runs" >/dev/null; then
    if (( $(date +%s) >= deadline )); then
      echo "gate: main の CI が ${timeout} 秒たっても終わらない → 全部のテストを流す"
      decide false
    fi
    echo "gate: main の CI が動いている。終わるまで待つ（${interval}秒ごと）"
    sleep "$interval"
    continue
  fi

  if [[ "$(jq 'length' <<<"$runs")" == "0" ]]; then
    echo "gate: ${sha} の main の CI が見つからない（main を通っていない push など）→ 全部のテストを流す"
  else
    echo "gate: ${sha} の main の CI は成功していない → 全部のテストを流す"
  fi
  decide false
done
