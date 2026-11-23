# ブラウザから YouTube に配信する（手元の中継アプリと YouTube 連携）(#11)

- 状態: **設計**（実装前。オーナーの確認待ち）
- 依頼: kojira 2026-11-23「ブラウザだけで YouTube 配信するのは難しい？」。中継アプリを各自の PC に入れる形にする。
  中継アプリは軽くし、Go（Pion）で書く。Google アカウントと連携して、配信の予約・開始・停止・チャットまで扱う。
  ハードウェアエンコーダーを使う（オーナー 2026-11-23「ハードウェアエンコーダーちゃんと使うようにお願いします」）。
- 関連: #11（ブラウザから直接ライブ配信）、#564（YouTube Live のコメントを配信画面に出す）、
  docs/event-signal.md（合図とポーリング禁止）、docs/live-set-visual-design.md（配信セット）
- 試作: 手元の中継アプリを試作して測った（2026-11-23、Apple Silicon の Mac・Chrome 157）。結果は §11。**動く**（ハードウェアで圧縮し、中継アプリは映像をコピーするだけ）
- 単体配信: 中継アプリは、ブラウザが無くても**アプリだけで配信できる**ようにする（オーナー 2026-11-23「アプリ自体を配信するなら単体でも配信できないといけない」）。§4.7

## 1. 何をするか・しないか

**やること**

- 配信の担当者が、events lab の配信画面（`/live/screen`）の映像と音を、**OBS を使わずに** YouTube へ流せるようにする。
- 流れは **ブラウザ →(WebRTC / WHIP)→ 同じ PC の中継アプリ →(RTMP)→ YouTube**。
  ブラウザは YouTube が受け取る形（RTMP / HLS）で直接送れず、YouTube は WebRTC を受け取らないため、間に中継が要る。
  中継はクラウドに置かず（費用）、配信する人の PC に入れてもらう（オーナー決定 2026-11-23）。
- Google アカウントと連携し、events lab から YouTube の配信を予約する・配信キーを受け取る・開始と終了を切り替える・
  ライブチャットを読む（#564）。
- 映像の圧縮は**ハードウェアエンコーダー**で行う（§5）。

**やらないこと（この段階）**

- 複数の配信先に同時に流す（YouTube と X など）。
- 録画・アーカイブの保存（YouTube 側のアーカイブに任せる）。
- クラウドの中継（Cloudflare Stream Live など。費用のため見送り）。
- スマホからの配信。対象は PC の Chrome（§4.4）。
- YouTube チャットへの書き込み（読むだけ。§7.5）。
- OBS の置き換えを強制すること。**OBS で `/live/screen` を取り込む今の方法は、そのまま残す**（予備の方法）。

## 2. 今の作り（コードで確認したこと）

- **配信画面 `/live/screen`**（`apps/web/src/pages/LiveScreenPage.tsx`）: OBS がウィンドウごと取り込む前提の完成画面。
  ウィンドウいっぱいに 16:9 の舞台を描く（`stageW = min(幅, 高さ×16/9)`）。中身は次のとおり。
  - シーン: 配信セットのシーンを `LiveSceneStage`（`components/LiveStage.tsx`）が DOM で描く。スライドは `SlideStage`、
    カメラは `<video>`（`useCameraStreams` で `getUserMedia`。#570 のカメラ番号）、チャットは `LiveEventChat`。
  - 参戦演出 `LiveCutinScreen`、LIVE 表示、時計。
  - BGM: 配信画面の中の `<audio>` で鳴らす。**OBS のデスクトップ音声が拾う前提**（コードのコメントどおり）。
    自動再生が止められたら「音を出す」ボタンを出す（`audioBlocked`）。
  - 状態は `GET /api/events/:id/live-state` と合図 `live`（docs/event-signal.md 5b-2）で取り直す。定期の取り直しは無い。
- **配信コントロール `/live/control`**（`LiveControlPage.tsx`）: 運営が配信セット・シーン・BGM・スライド・
  チャットの出し方（`chatSource: off | event`）・参戦演出・LIVE 表示を操作する。「配信画面を開く」で `/live/screen` を別タブで開き、
  「OBS で取り込んでください」と案内している。
- 状態は `event_live_state`（0019 から列を追加）に1イベント1行。操作は staff だけ（`requireEventRole(["staff"])`）。
- **映像を1本にまとめる仕組みは今は無い**。舞台は DOM（HTML・CSS・`<video>`・SVG）でできていて、まとめているのは OBS。
- 会場の欄 `venueOnline`（自由入力の URL）がイベントページに出る。YouTube の URL を載せる専用の場所は無い。
- Google ログイン（`apps/server/src/auth/providers.ts`）はある。scope は `openid email profile`、`access_type: online`。
  **YouTube の権限は無く、トークンも保存していない**。ログインとは別に連携する必要がある。
- 定期実行は Workers の cron ではなく、GitHub Actions から `/api/cron/*` を叩いている（Workers Free の cron 上限のため）。
- アプリ全体の Content-Security-Policy は無い（`connect-src` で localhost が止められることはない）。

## 3. 映像を1本にする方法

**決定: 配信画面のタブそのものを、タブの取り込み（`getDisplayMedia`）で1本の映像にする。**

| 方式 | 長所 | 短所 |
|---|---|---|
| **A. タブの取り込み**（`getDisplayMedia({ preferCurrentTab: true, audio: true })`） | 今の配信画面（DOM・カメラ・スライド・演出・チャット・BGM）が**そのまま**映る。作り直しが無い。BGM の音もタブの音として一緒に取れる | 始めるときにブラウザの「共有するタブを選ぶ」画面が必ず1回出る（省略できない）。タブを隠すと描画が間引かれることがある |
| B. canvas に描き直す（`canvas.captureStream`） | 確認画面が出ない | 舞台は DOM なので、canvas に同じものを描くには舞台・スライド・チャット・演出を全部作り直すことになる。二重の実装が増え、見た目がずれる |

A を選ぶ理由: 見た目が今と完全に同じで、作るものが最小。確認画面は配信の始めに1回だけなので受け入れる。

- 取り込みは**配信画面のタブ自身**から呼ぶ（`/live/screen` に「配信を始める」ボタンを置く。§8）。
  `preferCurrentTab: true` で「このタブ」を一番上に出し、`selfBrowserSurface: "include"`、
  `surfaceSwitching: "exclude"`（途中で別のタブに切り替えさせない）を付ける。
- 映像の大きさ: 配信画面のタブを 1280×720 か 1920×1080 にして取り込む。舞台の外（黒帯）が入らないよう、
  配信中は舞台をウィンドウいっぱいに合わせる（今の `stageW` の計算のまま）。取り込みの
  `width / height / frameRate` を指定し、合わなければ画面に「ウィンドウを 16:9 にしてください」と出す。
- 音: `audio: true` でタブの音（BGM・演出の音）を取る。**マイクは別に `getUserMedia({ audio })` で取り**、
  ブラウザの WebAudio で1本に混ぜてから送る（取り込みの音とマイクの音を2本送らない）。マイクの on/off と音量は
  コントロールに置く。
- タブを隠すと描画が間引かれる心配: 配信中は配信画面のタブを**前に出したまま**にするよう案内する
  （OBS のときと同じ使い方）。試作で、隠したときに映像が止まるかを確かめる（§11）。
- Region Capture（`CropTarget`）で舞台だけを切り出す方法もあるが、舞台をウィンドウいっぱいにすれば要らない。この段階では使わない。

## 4. 手元の中継アプリ

### 4.1 何をするか

- Go（Pion WebRTC）で書いた**1つの実行ファイル**。macOS（Apple Silicon・Intel）と Windows（x64）向け。
- PC の中だけで待ち受ける（`127.0.0.1` だけ。外のネットワークには開かない）。
- ブラウザから WHIP で WebRTC を受け取り、**映像は変換せずに**（H.264 のまま）FLV に詰め替えて、RTMP で YouTube に送る。
- 設定ファイルは持たない。起動したらブラウザから操作する。

### 4.2 受け口（HTTP、`http://127.0.0.1:<port>`）

ポートは固定の既定値（**47801**）。使われていたら 47802〜47809 を順に試す。ブラウザは同じ順に探す（§4.4）。

| メソッドとパス | 中身 | 応答 |
|---|---|---|
| `GET /v1/hello` | 生存確認。**ペアリング前でも答える** | `{ app: "eventslab-relay", version, paired: bool }` |
| `POST /v1/pair` | ペアリング（§4.3）。本体 `{ origin, code }` | 200 `{ token }` / 403 |
| `POST /v1/start` | 送り先を渡す。本体 `{ rtmpUrl, streamKey }` | 200 `{ whipUrl }`。鍵はメモリにだけ置く |
| `POST /v1/whip` | WHIP（SDP offer → answer）。`Content-Type: application/sdp` | 201 + `Location` |
| `DELETE /v1/whip/:id` | 配信を止める（WebRTC を閉じ、RTMP を閉じる） | 200 |
| `GET /v1/status` | `{ state: idle｜connecting｜live｜error, videoKbps, audioKbps, droppedFrames, rtmp: ok｜retrying｜failed, error? }` | 200 |

- `/v1/hello` 以外は `Authorization: Bearer <token>` が要る。
- **CORS**: `Origin` が許可リストのときだけ `Access-Control-Allow-Origin: <その origin>` を返す。許可リストは
  `https://events.kojira.io` と `https://eventer-staging.kojiran.workers.dev` を組み込みで持つ（開発用に
  `--allow-origin http://localhost:5173` を起動オプションで足せる）。ほかの origin には CORS ヘッダーを返さない。
- 昔の Private Network Access のプリフライト（`Access-Control-Request-Private-Network: true`）が来たら
  `Access-Control-Allow-Private-Network: true` を返す（古い Chrome 向け。害はない）。
- 送り先の鍵（`streamKey`）は**ログに出さない**。ログに出す RTMP の URL は鍵の部分を `****` にする。

### 4.3 ほかのサイトに使わせない（ペアリング）

127.0.0.1 は、どのサイトのページからでも届く。悪いサイトに勝手に配信させないよう、**ペアリング**を必須にする。

1. 中継アプリは、起動したときに 6 桁の番号を画面（ターミナルか小さなウィンドウ）に出す。
2. events lab の画面で「中継アプリとつなぐ」→ 番号を入れる → `POST /v1/pair { origin, code }`。
3. origin が許可リストに入っていて、番号が合えば、中継アプリはランダムなトークンを返し、`origin` と組で覚える
   （利用者のホーム下の設定フォルダに保存。次からは番号なしでつながる）。
4. ブラウザはトークンを `localStorage` に置く（events lab の origin の中だけ）。
- 番号は 5 回間違えたら作り直す。トークンは中継アプリの「つなぎ直す」で消せる。
- CORS で origin を絞るのは、ほかのサイトに**応答を読ませない**ため。トークンは、**操作そのもの**（配信開始）を止めるため。両方使う。

### 4.4 ブラウザから中継アプリへの通信（Chrome のローカルネットワーク アクセス）

- https のページ（events lab）から `http://127.0.0.1` へ `fetch` する。Chrome は **Local Network Access** の許可確認を
  出す（Chrome 142 から。2025-09 の Chrome 公式ブログ）。初回に1回「このサイトにローカルネットワークへのアクセスを許可しますか」が出る。
  許可されれば、混在コンテンツ（https → http）の制限からも外れる。
  - `fetch(url, { targetAddressSpace: "local" })` を付けて、Chrome に「手元への通信」だと先に知らせる。
  - 拒否されたときは、Chrome の「サイトの設定」から許可し直す手順を画面に出す。
- WebRTC の通信そのもの（WHIP のあとの UDP）は、同じ PC の中なので外には出ない。WebRTC は今のところこの許可確認の対象外
  （Chrome ブログの既知の制限）だが、WHIP の `fetch` で許可は済んでいる。
- **対象ブラウザは PC の Chrome（と Edge）**。Safari と Firefox は、ハードウェアの H.264 送信と
  ローカルネットワークの扱いを確かめていないので、この段階では「対応していません。Chrome を使ってください」と出す。
- 中継アプリの見つけ方: `/live/screen` と `/live/control` を開いたら `GET /v1/hello` を 47801〜47809 に**1回だけ**送る
  （定期の確認はしない。docs/event-signal.md の方針）。見つからなければ「中継アプリが動いていません」と出し、
  「もう一度探す」ボタンとダウンロードの案内を出す。

### 4.5 音声（Opus → AAC）

YouTube の RTMP は音声に AAC を求める。ブラウザの WebRTC が送る音声は Opus なので、どこかで変換が要る。

- **決定（試作の結果、§11）: 中継アプリから ffmpeg を呼び、音声だけ変換する**（Ogg/Opus → ffmpeg → ADTS AAC-LC 128kbps → FLV）。
  映像は ffmpeg を通さない。重さは CPU 約2%・メモリ約16MB。
  - Chrome の WebRTC は AAC を送れない（`getCapabilities("audio")` に AAC が無い。Chrome 157 で確認）。
  - 純粋な Go の AAC エンコーダーで使える質のものは無い。
  - 別案: ブラウザの WebCodecs（`AudioEncoder` の `mp4a.40.2` は対応と確認）で AAC にして中継アプリに渡せば、ffmpeg は要らない。
    ただし画面側の作りと音ずれの合わせ込みが増えるので、この段階ではやらない。
- 音声の変換は CPU を少し使うが軽い（48kHz ステレオ 128kbps）。映像は変換しない（§5）。
- ffmpeg を配る場合は、LGPL のビルド（GPL の部品と fdk-aac を含まないもの）を使い、ライセンス表示を同梱する。

### 4.6 配り方と更新

- 置き場所: **GitHub の 428lab の新しいリポジトリ（例 `428lab/eventslab-relay`）の Releases**。
  events lab の画面のダウンロード案内は、そこの最新版へのリンクにする。
- 版: `vX.Y.Z`。`/v1/hello` が版を返し、events lab が対応している最低の版より古ければ「更新してください」と出す。
  自動更新はこの段階では作らない。
- **署名**:
  - macOS: Apple の Developer ID で署名・公証しないと、Gatekeeper が「開発元を確認できないため開けません」と止める
    （右クリックの「開く」で回避できる）。署名には Apple Developer Program（年 $99）が要る。
  - Windows: 署名しないと SmartScreen が「Windows によって PC が保護されました」と出す（「詳細情報」→「実行」で回避できる）。
    コード署名証明書は有料。
  - この段階では**署名しない**で、回避の手順をダウンロードの案内に書く（§12 決めてほしいこと 2）。
- 起動のしかた: ダブルクリックで起動し、小さなウィンドウ（またはターミナル）に状態とペアリング番号を出す。
  常駐させる仕組み（ログイン時の自動起動）はこの段階では作らない。

### 4.7 単体配信（ブラウザを使わない）

オーナー 2026-11-23「アプリ自体を配信するなら単体でも配信できないといけない」。

- 中継アプリが自分で画面・カメラ・マイクを取り込み、**ハードウェアエンコーダー**で圧縮して YouTube に送る形も持つ。
  中継アプリは ffmpeg を子プロセスとして動かし、見張る（止まったら知らせる）。
- macOS: 取り込みは avfoundation（画面・カメラ・マイク）、圧縮は `h264_videotoolbox`、音声は `aac_at`。
  試作（合成映像）で 720p30 は CPU 7.3%・メモリ71MB、1080p30 は CPU 10.4%・メモリ111MB。
  CPU で圧縮する libx264 は 1080p30 で CPU 45% だった（約4倍重い）。
- Windows（机上。手元に Windows が無く未確認）: 画面は `ddagrab`（GPU のまま）、カメラ・マイクは `dshow`、
  圧縮は `h264_nvenc` → `h264_qsv` → `h264_amf` → `h264_mf` の順に試して使えるものを選ぶ。**どれも無ければ配信を止めて知らせ、libx264 には落とさない。**
- macOS の許可: 画面収録・カメラ・マイクの許可が要る。初回にダイアログが出て、画面収録は「システム設定 → プライバシーとセキュリティ →
  画面とシステムオーディオ録音」で中継アプリをオンにし、アプリを開き直す必要がある。
  この許可は**署名した .app** でないと安定しない（署名の無い実行ファイルは、起動したターミナルの許可を借りるので分かりにくい）。
  → 単体配信を配るなら macOS の署名（§12 の 2）が要る。
- ffmpeg は、単体配信に要る部品（avfoundation / dshow / ddagrab・ハードウェアエンコーダー）を入れたビルドになり、20〜40MB ほど増える。
- 実際の画面・カメラの取り込みは、試作では自動の操作から許可が出せず確かめられなかった。オーナーの PC で一度確かめる。
- 順番: ブラウザからの配信（PR 1）を先に作り、単体配信はそのあと（§13 の PR 1b）。

## 5. ハードウェアエンコード

**映像の圧縮はブラウザが行い、ハードウェアエンコーダーを使う。中継アプリは映像を変換しない。**

- 圧縮するのはブラウザの WebRTC。macOS は VideoToolbox、Windows は Media Foundation 経由で
  NVIDIA（NVENC）・Intel（Quick Sync）・AMD（AMF）のハードウェアを使う。
- **コーデックは H.264 を選ぶ**。`RTCRtpTransceiver.setCodecPreferences()` で H.264 を先頭にする。
  プロファイルは **Constrained Baseline（`profile-level-id=42e01f` / 1080p は `42e028`）を第一、High（`640c1f` / `640c28`）を第二**にする
  （Chrome がハードウェアで送れる組み合わせ。どれが選ばれたかは試作で確かめて §11 に書く）。
  VP8・VP9 はハードウェアで送れない PC が多く、YouTube の RTMP にも載らないので使わない。
- 画質の選択肢:

  | 名前 | 大きさ | fps | 映像のビットレート | 音声 |
  |---|---|---|---|---|
  | 標準（既定） | 1280×720 | 30 | 3,500 kbps | AAC 128 kbps |
  | 高画質 | 1920×1080 | 30 | 6,000 kbps | AAC 128 kbps |

  ビットレートは `RTCRtpSender.setParameters({ encodings: [{ maxBitrate, maxFramerate }] })` で決める。
  キーフレームの間隔は YouTube の推奨（2 秒ごと）に近づけるよう、中継アプリが2秒ごとに PLI（キーフレームの要求）を送る。
- **配信中に、本当にハードウェアで圧縮しているかを確かめる**:
  - `RTCPeerConnection.getStats()` の `outbound-rtp` の `encoderImplementation` と `powerEfficientEncoder` を、
    配信を始めた直後と、その後は**状態が変わったとき**（`connectionstatechange`、解像度の変化）に読む。定期には読まない。
  - `powerEfficientEncoder: true`、または `encoderImplementation` がハードウェアの名前（"VideoToolbox"、"MediaFoundationVideoEncodeAccelerator" など）なら OK。
  - `"OpenH264"`・`"libvpx"`・`"SimulcastEncoderAdapter (OpenH264…)"` のようにソフトウェアだったら、`/live/control` に
    **警告**を出す:「ハードウェアで圧縮できていません。PC が重くなります」。あわせて次を案内する。
    - Chrome の `chrome://gpu` で「Video Encode: Hardware accelerated」になっているか確かめる。
    - 画質を「標準（720p）」に下げる。
    - それでもだめなら OBS（NVENC・VideoToolbox などのハードウェアエンコーダー）で `/live/screen` を取り込む今の方法に切り替える。
  - 警告が出ても配信は止めない（止めるかどうかは運営が決める）。
- **中継アプリは映像を変換しない**（H.264 のまま FLV に詰める）。将来どうしても映像の変換が要るときは、
  ハードウェアのエンコーダー（`h264_videotoolbox`・`h264_nvenc`・`h264_qsv`・`h264_amf`・`h264_mf`）だけを使う。
  **libx264（ソフトウェア）は使わない**。

## 6. 配信の流れ（運営の操作）

1. （前もって）運営が Google アカウントをつなぎ、イベントの YouTube 配信を予約する（§7）。
   予約すると、YouTube の配信 URL がイベントページに出る。
2. 当日、配信担当が自分の PC で中継アプリを起動し、`/live/screen` を開く。初回はペアリングする（§4.3）。
3. `/live/screen` の「配信を始める」→ タブの共有を許可 → マイクを選ぶ。
   events lab のサーバーから**その配信の RTMP の URL と配信キー**を受け取り、中継アプリの `/v1/start` に渡す。
4. 中継アプリが YouTube に送り始める。YouTube 側で映像が届いたら（`liveStreams` の `streamStatus: active`）、
   `/live/control` の「本番開始」で YouTube の配信を `testing → live` に切り替える。
5. 終わったら「配信を終える」で YouTube を `complete` にし、中継アプリを止める（WHIP の `DELETE`）。

- Google 連携をしていないイベントでも使えるよう、**配信キーを手で入れる**方法も残す（YouTube Studio からコピーして貼る）。
  手で入れたキーはブラウザの中だけで使い、サーバーには送らない。

## 7. YouTube 連携

### 7.1 権限（OAuth）

- scope は **`https://www.googleapis.com/auth/youtube.force-ssl`** の1つ。予約・配信キー・開始と終了・チャットの読み取りを1つで扱える
  （`liveBroadcasts.insert`・`transition` の Scope 欄に `youtube` と `youtube.force-ssl` が並んでいる。Google のドキュメントで確認）。
- `access_type=offline` と `prompt=consent` で、更新用のトークン（refresh token）を受け取る。
- ログインの Google（`openid email profile`）とは**別の連携**にする。同じ Google のクライアント ID を使い、
  連携のときだけ YouTube の scope を求める（ログインのたびに YouTube の権限を求めない）。
- **Google の審査**: YouTube の scope は審査が要る種類。審査を通るまでは、Google Cloud の OAuth 同意画面を「テスト」の状態で使う。
  - テストの状態では、使えるのは**登録したテストユーザー 100 人まで**。同意の画面に「確認されていないアプリ」の警告が出る。
  - テストの状態では、**同意から 7 日で更新用トークンが切れる**（Google Cloud のヘルプで確認）。
    つまり週に1回つなぎ直しが要る。本番運用には審査が必要（§12 決めてほしいこと 3）。
  - 審査（ブランドの確認と、scope の正当性の説明・動画）は kojira の Google アカウントでしかできない。

### 7.2 使う API と量の上限

既定の量の上限は **1日 10,000 単位**（太平洋時間の深夜に戻る。Google のドキュメントで確認）。

| 操作 | API | 単位（Google の表で確認） |
|---|---|---|
| 予約を作る | `liveBroadcasts.insert` | 1 |
| 送り先を作る（配信キー） | `liveStreams.insert` | 1 |
| 予約と送り先をつなぐ | `liveBroadcasts.bind` | 1 |
| 状態を見る | `liveBroadcasts.list` / `liveStreams.list` | 1 |
| 開始・終了 | `liveBroadcasts.transition` | 1 |
| サムネイル | `thumbnails.set` | 50 |
| チャットを受け取る（つなぎっぱなし） | `liveChatMessages.streamList` | 5（1回つなぐごと） |
| チャットを読む（取りに行く） | `liveChatMessages.list` | 5（1回ごと） |

- 予約から終了までの1回の配信で、チャットを除けば 10〜20 単位ほど。十分足りる。
- チャットは `streamList`（サーバーから流してくる、つなぎっぱなしの読み方。gRPC）を使う。1回つなぐと 5 単位で、
  切れたら `nextPageToken` から続きを受け取れる。**`list` で取りに行き続ける**と、`pollingIntervalMillis`（数秒）ごとに 5 単位かかり、
  2 時間で数千単位になって上限に近づくので使わない。

### 7.3 予約から終了まで

1. `liveBroadcasts.insert`（題名・説明・開始予定・公開範囲・`enableMonitorStream: true`・`enableAutoStart: false`・`enableAutoStop: false`）
2. `liveStreams.insert`（`cdn.ingestionType: rtmp`、`resolution` と `frameRate` は画質の選択肢に合わせる）
3. `liveBroadcasts.bind`（予約と送り先をつなぐ）
4. （当日）中継アプリが送り始める → `liveStreams.list` で `streamStatus: active` を確かめる
   → `transition(testing)` → 運営が「本番開始」→ `transition(live)`
5. 「配信を終える」→ `transition(complete)`
- 自動の開始・終了（`enableAutoStart` / `enableAutoStop`）は使わない。運営のボタンで切り替える（勝手に始まらないように）。
- 状態の確認はボタンを押したときと、中継アプリが「送れている」と言ったときだけ行う。定期には見ない。

### 7.4 トークンの保管

- 新しい表 `youtube_link`（§9）に、**更新用トークンを暗号化して**保存する。
  - 暗号化は AES-GCM。鍵は新しい secret `YOUTUBE_TOKEN_KEY`（wrangler secret）。D1 には暗号文と IV だけを置く。
  - アクセス用のトークン（1時間）は保存しない。使うたびに更新用トークンから取り直す。
- **誰の連携か**: 連携は**つないだ本人のもの**（user 単位）。イベントでは「この配信は ◯◯ さんの YouTube で」と選ぶ。
  - そのイベントの確定スタッフなら、選ばれた連携を使って予約・開始・終了ができる（本人がその場にいなくても運営が回せるように）。
  - 連携した本人はいつでも外せる。外すと Google に取り消し（`https://oauth2.googleapis.com/revoke`）を送り、行を消す。
    そのイベントの予約は YouTube 側に残る（events lab からは操作できなくなる）。
  - 本人がそのイベントのスタッフでなくなったら、そのイベントでは使えなくなる。
- 更新用トークンが使えなくなった（7日で切れた・取り消された）ら `invalid_grant` が返る。行に「つなぎ直しが要る」と記録し、
  画面に出す。

### 7.5 チャット（#564）

- events lab のサーバーは、YouTube のチャットを**取りに行き続けない**（docs/event-signal.md のポーリング禁止）。
- チャットを読むのは、**配信しているブラウザ（`/live/screen`）**にする。
  - 配信中、`/live/screen` は events lab のサーバーに「チャットを受け取る」を頼む。サーバーは `liveChatMessages.streamList` に
    つなぎ、届いたメッセージをそのブラウザに流す（Server-Sent Events、1接続）。ブラウザが閉じたら切る。
  - 理由: Workers は gRPC のつなぎっぱなしを長く持てない可能性がある（**未確認**。Workers の HTTP/2 と gRPC の扱いを試作で確かめる）。
    だめなら、サーバーはアクセス用トークンだけを `/live/screen` に渡し、ブラウザが `streamList`（gRPC-Web 相当）か
    `list` を `pollingIntervalMillis` に従って読む。後者は Google が間隔を指定する仕組みなので、events lab の「勝手に定期で取りに行かない」の例外として記録する。
- 表示: 今の配信チャット（`LiveChatRow`）に `source: "youtube"` を足し、events lab のチャットと**時刻順に混ぜて**出す（#564 の完成形）。
  `chatSource` に `youtube` と `both` を足す。
- 書き込み（`liveChatMessages.insert`）と、モデレーション（削除・ブロック）はこの段階では作らない。

## 8. 画面

- **運営ページ**（`/events/:id/manage`）に「YouTube 配信」の欄を足す（staff だけ）。
  - 連携: 「YouTube とつなぐ」（Google の同意画面へ）。つないだ連携の一覧（チャンネル名・アイコン）と「外す」。
  - 予約: 題名（既定はイベント名）・説明（既定はイベントの説明の先頭とイベントページの URL）・開始予定（既定はイベントの開始）・
    公開範囲（公開／限定公開／非公開。既定は限定公開）・画質（標準／高画質）。「予約する」で §7.3 の 1〜3 を行う。
  - 予約後: YouTube の配信 URL と状態（予約済み・準備中・配信中・終了）を出す。「予約を取り消す」。
- **イベントページ**: 予約があり、公開範囲が「公開」か「限定公開」なら、会場の欄の近くに「YouTube で見る」のリンクを出す。
  非公開のイベントでは、見られる人にだけ出す（今のイベントの見え方に従う）。
- **`/live/screen`**: 上の端に小さな配信のバー（配信中は隠せる）。
  - 中継アプリの状態（見つからない・つないでいない・つないだ）、「配信を始める」「配信を止める」。
  - 配信中: 映像と音のビットレート、落ちたフレーム、ハードウェアで圧縮しているか。
- **`/live/control`**: 配信の状態（中継アプリの状態は `/live/screen` から BroadcastChannel で受け取る。今のカメラの状態と同じ仕組み）、
  「本番開始」（testing → live）・「配信を終える」（complete）、ハードウェアでないときの警告（§5）。
- 文言は ja / en（docs/i18n-notices.md のとおり）。エラーは `MessageKey` で持つ（#369）。

## 9. データと API

**migration 0129**（次の番号。0128 が最後）

```sql
-- YouTube の連携（つないだ本人のもの）。更新用トークンは AES-GCM で暗号化して置く。
CREATE TABLE youtube_link (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  channel_title TEXT NOT NULL,
  channel_thumbnail TEXT,
  refresh_token_enc TEXT NOT NULL,   -- base64(iv || ciphertext)
  needs_relink INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, channel_id)
);
-- イベントごとの YouTube の配信（この段階では1イベント1つ）
CREATE TABLE event_youtube_broadcast (
  event_id TEXT PRIMARY KEY REFERENCES event(id) ON DELETE CASCADE,
  link_id TEXT REFERENCES youtube_link(id) ON DELETE SET NULL,
  broadcast_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  live_chat_id TEXT,
  privacy TEXT NOT NULL CHECK (privacy IN ('public','unlisted','private')),
  quality TEXT NOT NULL CHECK (quality IN ('720p30','1080p30')),
  status TEXT NOT NULL,  -- created | ready | testing | live | complete | revoked
  created_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- **配信キー（`streamName`）はサーバーに保存しない**。必要なとき（配信を始めるとき）に `liveStreams.list` で取り、
  その応答のまま配信担当のブラウザに返す。サーバーのログにも出さない。
- API（全部 `/api` の下）:

  | メソッドとパス | 権限 | 中身 |
  |---|---|---|
  | `GET /youtube/links` | 本人 | 自分の連携の一覧 |
  | `GET /youtube/link/start` → Google → `GET /youtube/link/callback` | 本人 | 連携（state で CSRF を防ぐ） |
  | `DELETE /youtube/links/:id` | 本人 | 連携を外す（Google に取り消し） |
  | `GET /events/:id/youtube` | staff | 予約と状態 |
  | `POST /events/:id/youtube` | 確定 staff | 予約する（§7.3 の 1〜3） |
  | `DELETE /events/:id/youtube` | 確定 staff | 予約を取り消す（YouTube の予約も消す） |
  | `POST /events/:id/youtube/ingest` | 確定 staff | その配信の RTMP の URL と配信キーを返す（キャッシュ不可） |
  | `POST /events/:id/youtube/transition` | 確定 staff | `{ to: testing｜live｜complete }` |
  | `GET /events/:id/youtube/chat` | 確定 staff | チャットを受け取る（SSE。§7.5） |

  公開の情報（YouTube の URL と状態）は、イベントの応答に `youtube: { url, status } | null` として足す。
- 予約・開始・終了は監査ログに残す（`audit` の action に `youtube_broadcast_*`）。

## 10. 失敗したとき

| 起きたこと | どうなるか |
|---|---|
| 中継アプリが動いていない・見つからない | `/live/screen` に「中継アプリが動いていません」と出し、「もう一度探す」とダウンロードの案内 |
| ペアリングが切れた（トークンが合わない） | 401 → 「中継アプリとつなぎ直してください」 |
| Chrome がローカルネットワークの許可を拒否した | 許可し直す手順を出す |
| タブの共有を取り消した（ブラウザの「共有を停止」） | 配信を止める（WHIP の `DELETE`）。YouTube は `live` のまま残るので、コントロールに「映像が止まっています」と出す |
| YouTube に送れない（RTMP の接続が切れた） | 中継アプリが 2・4・8・16 秒あけて最大 5 回つなぎ直す。だめなら `rtmp: failed` で止め、画面に出す |
| 回線が細くなった | WebRTC がビットレートを下げる（ブラウザの制御のまま）。落ちたフレームを画面に出す |
| ハードウェアで圧縮できていない | §5 の警告（止めない） |
| YouTube の API が断った（量の上限・権限・状態の順番違い） | 理由を画面に出す。`transition` の順番違いは、今の状態を読み直してから案内する |
| 更新用トークンが切れた・取り消された | `needs_relink` を立て、「YouTube とつなぎ直してください」（つないだ本人に出す。運営には「◯◯ さんのつなぎ直しが要る」） |

## 11. 試作の結果

2026-11-23、Apple Silicon の Mac・Chrome 157。手元だけで行い、YouTube には送っていない（手元の RTMP で受けて録画）。
試作のコードと記録: `~/tmpimg/yt-relay/proto/`（リポジトリの外）。

| 項目 | 結果 |
|---|---|
| ブラウザで選ばれた H.264 のプロファイル・`encoderImplementation` | macOS: High（`64001f`）、**`VideoToolbox`・`powerEfficientEncoder: true`**（720p・1080p とも）。ソフトウェアに落とすと `OpenH264`・`false`。Windows は未確認 |
| `encoderImplementation` を読む条件 | Chrome は、ページがカメラかマイクを取り込んでいるときだけこの値を見せる（指紋対策）。配信画面はマイクを取り込むので読める。取れないときは「不明」と出し、「ソフトウェア」とは言わない |
| ハードウェアとソフトウェアでのブラウザの CPU | 合成した単純な画面では差が小さかった（20〜23% と 22〜25%）。カメラとスライドの入った実際の画面で測り直す |
| 中継アプリの大きさ（`-s -w` で小さくしたもの） | darwin/arm64 **10.9MB**、darwin/amd64 11.7MB、windows/amd64 11.8MB（ffmpeg は別） |
| 配信中の中継アプリのメモリと CPU | 720p・1080p とも **CPU 約2%・メモリ約27MB**。音声の ffmpeg は CPU 約2%・メモリ約16MB |
| 録画の確認 | 720p・1080p とも、H.264 High + AAC-LC 48kHz。**再生して壊れたコマ 0** |
| 音声の変換 | ffmpeg で音声だけ（§4.5）。Chrome の WebRTC は AAC を送れない |
| 遅延（画面の時計と、受け取った側で映ったときの差） | 中央値 **125ms**（90% 209ms）。YouTube 側の遅れ（数秒）は含まない |
| 画の乱れの対策（中継アプリに必須） | macOS の VideoToolbox は、キーフレームを求めた直後に「IDR なのに中身が P スライス」のコマを出すことがある。そのまま流すと画が崩れる。中継アプリで見分けて捨て、次の本物の IDR まで待ってキーフレームを求め直す。パケットが欠けたときも同じく次の IDR まで待つ。これで壊れたコマ 0 になった |
| ビットレート | 手元の通信でも Chrome は低い所から少しずつしか上げない（60秒で 1Mbps）。transport-cc と SDP の `x-google-start-bitrate` などで、最初から目標（720p 2.5〜3Mbps）に届くようにした |
| フレームレート | 合成した試験映像では約25fps（Chrome がコマを渡す側の制限。中継アプリは受けたコマを全部流した）。実際のタブの取り込みで測り直す |
| タブを隠したときに映像が止まるか | 自動の操作では確かめられなかった。オーナーの PC で一度確かめる |
| https のページ（events.kojira.io）から 127.0.0.1 につなぐ | 試作は localhost どうしで確認。https からは未確認。PR 1 の前にオーナーの PC で確かめる |
| 単体配信（§4.7） | 合成映像 + `h264_videotoolbox` で 720p30 CPU 7.3%、1080p30 CPU 10.4%。実際の画面の取り込みは許可の都合で未確認 |
| Workers から gRPC（`streamList`）を長くつなげるか | **未確認**（PR 4 の前に確かめる） |

## 12. 決めてほしいこと

| # | 論点 | 選択肢 | おすすめ |
|---|---|---|---|
| 1 | 中継アプリの置き場所 | A. 新しいリポジトリ `428lab/eventslab-relay`（Releases で配る） / B. events のリポジトリの中 | **A**（Go のコードと配布物を Web アプリと分ける。版の管理が単純） |
| 2 | 署名 | A. 署名しない（回避手順を案内） / B. Apple Developer ID（年 $99）で macOS だけ署名・公証 / C. macOS と Windows の両方に署名 | **ブラウザからの配信（PR 1）は A で始める。単体配信（PR 1b）を配るときに B**（macOS の画面収録の許可は、署名した .app でないと安定しないため。§4.7） |
| 3 | Google の審査 | A. テストの状態のまま（100 人まで・7日ごとにつなぎ直し） / B. 審査に出す | **A で始め、PR 2 が動いたら B**。審査には動画と説明が要り、kojira の作業になる |
| 4 | 予約の公開範囲の既定 | 公開 / 限定公開 / 非公開 | **限定公開**（URL を知っている人だけ。間違って公開しない） |

## 13. 進め方（PR の分け方）

| PR | 中身 | 終わりの条件 |
|---|---|---|
| **0. 試作**（済み。リポジトリ外） | 中継アプリの試作と計測 | 済み（§11）。音声は ffmpeg で音声だけ変換に決めた |
| **1. 中継アプリ v0 と配信画面からの送出** | 中継アプリ（§4）。`/live/screen` の配信バー（ペアリング・タブの取り込み・マイクの混合・WHIP）。**配信キーは手で入れる**。ハードウェアの確認と警告（§5） | 手で入れた YouTube の配信キーで、`/live/screen` の映像と BGM とマイクが YouTube（限定公開）に届く。`encoderImplementation` がハードウェアの名前になる。中継アプリを止めたとき・タブの共有を止めたときに §10 のとおりに出る |
| **1b. 単体配信** | 中継アプリが画面・カメラ・マイクを取り込んで、ハードウェアエンコーダーで送る（§4.7）。macOS の署名した .app | オーナーの Mac で、ブラウザを使わずに画面とマイクが YouTube（限定公開）に届く。`h264_videotoolbox` で圧縮される。ハードウェアエンコーダーが無いときは止めて知らせる |
| **2. Google 連携と予約** | `youtube_link`（0129）、連携と外す、運営ページの予約欄、イベントページの「YouTube で見る」 | テストユーザーがつなぎ、予約すると YouTube に予約が出て、イベントページにリンクが出る。外すと Google 側でも取り消される。トークンが D1 で暗号化されている |
| **3. 開始と終了の操作** | `ingest`（配信キーを受け取って中継アプリへ）、`transition`、`/live/control` のボタンと状態 | 配信キーを手で入れずに配信でき、「本番開始」「配信を終える」で YouTube 側が切り替わる。配信キーがサーバーのログにも D1 にも残らない |
| **4. チャット（#564）** | `streamList` の受け取り（§7.5）、`LiveChatRow` に YouTube を足す、`chatSource: youtube｜both` | 実際の限定公開の配信で、YouTube のコメントが events lab のチャットと時刻順に混ざって配信画面に出る。1回の配信で使う量の単位が数十に収まる |

## 14. 心配なこと

- **タブの共有の確認画面**が毎回出る。省けない（ブラウザの仕様）。
- **タブを隠すと描画が間引かれる**かもしれない（自動の操作では確かめられなかった。オーナーの PC で確かめる）。配信中は配信画面を前に出しておく必要がある。
- **Chrome の Local Network Access** はまだ変わっている途中（WebRTC への適用は今後。Chrome のブログ）。仕様が変わったら手順を直す。
- **Google の審査が通るまで7日ごとにつなぎ直し**。審査には時間がかかる。
- **ソフトウェアで圧縮される PC**（古い PC・GPU の無い Windows）では重くなる。そのときは OBS の方法に戻ってもらう。
- 中継アプリは**署名なし**だと、入れるときに警告が出る。
- 回線やPCの不調で配信が止まっても、YouTube の予約は `live` のまま残る。止まったことを運営が気づける表示が要る（§10）。
