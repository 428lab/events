# 配信画面から YouTube に配信する（手元の中継アプリ経由・配信キーは手で入れる）(#11)

- 状態: **実装**（設計 PR #702 の §13「PR 1」の events lab 側）。Google 連携（予約・配信キーの自動受け取り・開始と終了の切り替え）は後の PR
- 設計: docs/browser-live-youtube.md（PR #702）。中継アプリ: [428lab/eventslab-relay](https://github.com/428lab/eventslab-relay)
- 決定: オーナー 2026-11-23。中継アプリは各自の PC に入れる。ハードウェアエンコーダーを使う

## 運営の手順

1. 配信する PC で中継アプリ（eventslab-relay）を起動する。画面に 6 桁のペアリング番号が出る。
   音声の変換に ffmpeg が要る（中継アプリの README）。
2. その PC の **Chrome（か Edge）** で、イベントの配信画面 `/events/:id/live/screen` を開く。
3. 左下の「配信」を押す。中継アプリが見つかったら、初回だけ「中継アプリとつなぐ」に番号を入れる
   （次からは番号なしでつながる。トークンはこのサイトの localStorage に置く）。
   - Chrome が「ローカル ネットワークへのアクセス」を聞いてきたら「許可」。
4. 送り先（既定 `rtmp://a.rtmp.youtube.com/live2`）と、YouTube Studio の**配信キー**を貼る。画質（標準 720p / 高画質 1080p）と、
   マイクを流すかを選ぶ。
5. 「配信を始める」→ ブラウザの共有画面で **「このタブ」** を選ぶ。パネルは閉じ、配信が始まる。
   配信中は配信画面のタブを前に出したままにする（OBS で取り込んでいたときと同じ）。
6. 様子は左下の「配信中」を押すと出る（ビットレート・fps・大きさ・ハードウェアで圧縮しているか・YouTube に送れているか）。
   マイクの on/off もここ。終わったら「配信を止める」。

OBS で `/live/screen` を取り込む今の方法も、そのまま使える（予備の方法）。

## 決まりごと

- **配信キーは React の state にだけ置く。** 中継アプリの `POST /v1/start` に渡すだけで、events lab のサーバー（`/api`）には送らない。
  localStorage にも置かない（`apps/web/src/lib/liveRelay.test.ts` で固定）。画面を閉じると消える。
- バーは**運営（そのイベントの staff）と管理者**にだけ出す（配信コントロールと同じ）。
- 中継アプリを探すのは、配信画面を開いたときと「もう一度探す」を押したときの**1回だけ**（47801〜47809 を順に）。定期には探さない。
- 配信中だけ、5 秒ごとに手元の統計（`RTCPeerConnection.getStats()` と中継アプリの `/v1/status`）を読み直す。
  通信は同じ PC の中だけで、events lab のサーバーには問い合わせない。`setTimeout` の連鎖で、止めたら止まる（noPolling の対象外）。
- `fetch` には `targetAddressSpace: "loopback"` を付ける。**`local` ではない**: 127.0.0.1 は Chrome の分類で `loopback` で、
  `local` を付けると Chrome 157 は CORS エラーで断る（2026-11-23 に実際の Chrome で確かめた）。
- 映像は配信画面のタブそのもの（`getDisplayMedia({ preferCurrentTab, selfBrowserSurface: "include", surfaceSwitching: "exclude" })`）。
  タブの音（BGM・演出）とマイクは WebAudio で1本にまとめて送る。
- コーデックは H.264 を先頭に（High → Main → Constrained Baseline の順。`setCodecPreferences`）。画質の最大ビットレートを
  `setParameters` で決め、answer に `x-google-start-bitrate` などを書き足して、最初から目標のビットレートで送る（試作で確かめた方法）。
- ハードウェアかどうか: `outbound-rtp` の `powerEfficientEncoder` / `encoderImplementation`。ソフトウェア（OpenH264 など）なら
  警告と案内を出す（止めない）。Chrome はカメラかマイクを取り込んでいるページにしか見せないので、マイクを流さないと「不明」になる。

## 失敗したとき

| 起きたこと | 画面 |
|---|---|
| 中継アプリが見つからない | 「中継アプリが見つかりません」「もう一度探す」「ダウンロード」「使い方」と、ローカルネットワークの許可の案内 |
| 番号が違う | 「番号が違います」。間違いが続いたら中継アプリが待たせ（429）、待つ秒数を出す |
| トークンが合わない（401） | トークンを消し、「つなぎ直してください」 |
| タブを取り込めない・共有を取り消した | 「タブを取り込めませんでした」/「タブの共有が取り消されたため、配信を止めました」 |
| YouTube に送れない | 中継アプリの `rtmp: retrying / failed` と理由（キーは含まれない）を出す |
| ffmpeg が無い | 「中継アプリが ffmpeg を見つけられません」 |
| PC やブラウザが対応していない | 「PC の Chrome か Edge で開いてください」 |

## 確かめたこと（2026-11-23、Apple Silicon の Mac・Chrome 157・手元だけ）

本物の Chrome で `/live/screen` を開き、バーから中継アプリ（eventslab-relay main 8652648、`--dev`）を探す → ペアリング → 配信キーを入れて開始
→ 手元の RTMP（ffmpeg -listen）で 20 秒録画。

- 録画: H.264 High 1280×720 + AAC-LC、再生して壊れたコマ 0
- `encoderImplementation: VideoToolbox`（ハードウェア）
- 配信キーは events lab の `/api` への通信に 0 件、localStorage に無し。中継アプリのログは `****`
- 1080p（高画質）でも同じく通った（1920×1080、壊れたコマ 0、VideoToolbox）。中継アプリは CPU 1%前後・メモリ約26MB
- **フレームレートは自動の操作では確かめられていない**: 動くカメラのシーンでも、自動操作の Chrome のタブ取り込みは 6〜11fps・
  130〜270kbps だった（ヘッドレスでも画面ありでも同じ）。試作のときも自動操作のタブ取り込みは 5〜8fps で、合成映像（同じ Chrome・同じ中継アプリ）では
  25fps・2.5Mbps 出ているので、自動操作でのタブの取り込みの間引きと考えている。**本番で使う前に、人が操作する Chrome で「このタブ」を選んで、
  fps とビットレートを一度確かめる**（設計 §11 の残り）
