import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * 定期取得（ポーリング）を増やさないための見張り (D-POLL-MIN 第5段階 5b-5)。
 *
 * サーバーへの定期の問い合わせは全部やめ、変化はサーバーが出す合図
 * （docs/event-signal.md）で取り直す。`refetchInterval` は一切使わない。
 * `setInterval(` は時計の表示更新・接続の見張りなど「それ自体は通信しない」
 * 場所だけに許し、ファイルごとの個数で固定する。新しく足すときは、通信しない
 * ことを確かめてからここに理由つきで載せる。
 */
// vitest の root は apps/web
const srcDir = path.join(process.cwd(), "src");

const SET_INTERVAL_ALLOWED: Record<string, { count: number; why: string }> = {
  "components/LiveCutinScreen.tsx": { count: 1, why: "カットインの残り時間の表示（200ms の時計）" },
  "components/EventChat.tsx": { count: 1, why: "書き込み期間の判定に使う時計（60秒）" },
  "components/EntranceQrDialog.tsx": { count: 1, why: "QR の期限の表示（1秒の時計）。取り直しはタップのときだけ" },
  "components/BigQrDialog.tsx": { count: 1, why: "QR の表示上限の時計（1秒）" },
  "components/HomeDashboard.tsx": { count: 1, why: "「開催中」などの表示を切り替える時計（60秒）" },
  "components/LiveDynamic.tsx": { count: 1, why: "時計パーツの壁時計のずれ検知（通信なし）" },
  "components/LiveCameraMapPanel.tsx": { count: 1, why: "カメラ状態の経過時間の表示（1秒の時計）" },
  "lib/useEventTiming.ts": { count: 1, why: "開催前・中・後の切り替えの時計（60秒）" },
  "lib/nostrChat.ts": { count: 1, why: "リレー接続の見張り（切れたらつなぎ直すだけで、サーバーへは問い合わせない）" },
  "pages/CheckinPage.tsx": { count: 1, why: "カメラ映像から QR を読む繰り返し（端末内）" },
  "pages/LiveScreenPage.tsx": { count: 2, why: "壁時計（1秒）と、同じ端末の操作画面への BroadcastChannel 送信（2秒）" },
  "pages/DeckImportPage.tsx": { count: 1, why: "再試行までの残り時間の表示（1秒の時計）" },
  "pages/LiveControlPage.tsx": { count: 1, why: "チャット表示の経過時間の時計（1秒）" },
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) return [];
    return [full];
  });
}

const files = sourceFiles(srcDir).map((full) => ({
  rel: path.relative(srcDir, full).split(path.sep).join("/"),
  text: readFileSync(full, "utf-8"),
}));

describe("定期取得をしない (D-POLL-MIN)", () => {
  it("refetchInterval をどこでも使わない", () => {
    const offenders = files.filter((f) => /refetchInterval/.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("setInterval は許可した時計・見張りの場所だけ", () => {
    const found: Record<string, number> = {};
    for (const f of files) {
      const n = f.text.match(/setInterval\(/g)?.length ?? 0;
      if (n > 0) found[f.rel] = n;
    }
    const expected = Object.fromEntries(Object.entries(SET_INTERVAL_ALLOWED).map(([k, v]) => [k, v.count]));
    expect(found).toEqual(expected);
  });
});
