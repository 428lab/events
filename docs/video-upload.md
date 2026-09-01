# 動画を投稿できるようにする (#408)

- 対象: `apps/web`（エンコードパイプライン・投稿 UI・ギャラリー/メディアタブ表示）、
  `apps/server`（アップロード/配信 API・Range 対応・purge）、`packages/shared`（型・定数）
- 前提: #407（プロフィールのタブ化・メディアタブ）はマージ済み。メディアタブは
  「動画が増えても収まる命名・構造にする」前提で作られている（`docs/profile-tabs.md` §12）
- 決定済み（issue コメント 2026-08-26）: **保存形式は WebM を狙う**。
  **ブラウザ内でエンコードしてからアップロード**（Workers ではトランスコード不可）。
  方式は WebCodecs 優先で検討し、ffmpeg.wasm と比較して決めた
- ステータス: **実装済み**（PR #422 変換パイプライン＋実機計測ページ /
  PR #423 アップロード・保存・表示 / PR #426 トリミング = issue #425 /
  PR #428〜#430 複数本キュー等の実機フィードバック対応 = issue #427。§11 差分参照）

---

## 1. 方式の結論

**WebCodecs + mediabunny（クライアント側変換）を主軸にする。ffmpeg.wasm は使わない。**

- 出力の優先順位: **WebM（VP9 → VP8、音声 Opus）**。エンコーダが足りないブラウザ
  （Safari 16.4–18 系）では **MP4（H.264、音声 AAC パススルー）** に落とす。
  つまり保存形式は「WebM 主・MP4 従」の混在を許す
- 箱詰め（mux）・箱開け（demux）・変換のオーケストレーションは
  [mediabunny](https://mediabunny.dev/)（webm-muxer / mp4-muxer の後継、後述 §2.2）に任せる。
  コーデック処理自体はブラウザの WebCodecs（多くはハードウェア支援）が行う
- WebCodecs が丸ごと無い環境（現状 Firefox Android のみ）と、デコードできない入力は、
  「**元ファイルが MP4/WebM かつ上限内ならそのまま受ける／それ以外は明確なエラー**」
  にする（§4.3）。ffmpeg.wasm の遅延ロードは採用しない（§2.4）

### Safari をどうするか（モバイル利用が多いので最重要）

Safari は 16.4 から VideoEncoder/VideoDecoder を持ち、**VP8/VP9/H.264 のエンコードが
できる**（WebKit が libvpx バックエンドを 2022-10 に実装済み。実地データでも VP8
エンコードはセッションの 99.98% で利用可）。足りないのは **AudioEncoder（Opus）で、
これは Safari 26（2025-09、iOS 26 同梱）から**。

- **Safari 26 以降（iOS 26: 2026-06 時点で全 iPhone の 79% が搭載）**: WebM
  （VP8/VP9 + Opus）をフルにエンコードできる。本線に乗る
- **Safari 16.4–18 系（残り約 2 割）**: 映像は H.264 に再エンコードし、音声は
  **AAC のまま無変換で通して MP4 に箱詰め**する（AudioEncoder 不要。iPhone 撮影の
  音声は AAC なのでこの経路で拾える）。音声が AAC 以外で通せないときは
  「音声なしで投稿するか」を確認してから映像のみで受ける
- WebM の**再生**は iOS 15 以降の Safari で可能（VP8/VP9）。したがって WebM で保存した
  動画は古い iPhone でも視聴できる。逆に MP4 (H.264) は全ブラウザで再生できるので、
  混在保存で視聴側に穴は生じない

---

## 2. 調査結果（2026-08-26 時点。ウェブで確認）

### 2.1 WebCodecs の対応状況

| 環境 | VideoEncoder | エンコード可能なコーデック | AudioEncoder (Opus) |
|---|---|---|---|
| Chrome / Edge 94+（Android 含む） | ○ | VP8 / VP9 / AV1 / H.264（HW 支援あり） | ○ |
| Firefox 130+（デスクトップ） | ○ | VP8 / VP9 / AV1 / H.264 | ○ |
| Firefox Android | × 全バージョン非対応 | — | × |
| Safari 16.4–18 系 | ○（video のみ partial） | VP8 / VP9 / H.264（AV1 ×） | × AudioEncoder 自体が無い |
| Safari 26+（macOS / iOS / iPadOS） | ○ full | VP8 / VP9 / H.264（AV1 は限定的） | ○（Opus / AAC / FLAC） |

- 出典: [caniuse WebCodecs](https://caniuse.com/webcodecs)（Chrome/Edge 94+、Firefox 130+、
  Safari 16.4 partial → 26.0 full、Firefox Android 非対応）、
  [WebKit PR #4924](https://github.com/WebKit/WebKit/pull/4924)（VPx エンコーダ、2022-10-07 merge）、
  [MDN Codec selection](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection)、
  [WebCodecs Fundamentals 実地データ](https://webcodecsfundamentals.org/datasets/codec-support-table/)
  （114 万セッション: VP8 encode 99.98% / Opus encode 96.07%。**VP9 encode は 25.69% と
  低く出ており**、優先順位は VP9 → VP8 とするが実機で `canEncode` の実測を必須とする）
- AAC **エンコード**は Firefox 全プラットフォームと Linux で不可（実地 90.1% はこのため）。
  音声は Opus（WebM）か AAC パススルー（MP4）に限定し、AAC エンコードには依存しない
- iOS 26 普及率: Apple 公式で 2026-02 に全 iPhone の 66%、2026-06 に 79%
  （[9to5Mac](https://9to5mac.com/2026/02/13/apple-announces-ios-26-usage-numbers-heres-how-they-compare/)、
  [AppleInsider](https://appleinsider.com/articles/26/06/10/fewer-iphone-users-are-updating-to-ios-26-than-they-did-with-ios-18)）。
  StatCounter の低い数字は Safari 26 の UA 文字列変更による誤計測

### 2.2 muxer: mediabunny を採用

- [webm-muxer](https://github.com/Vanilagy/webm-muxer) / mp4-muxer は **deprecated**。
  後継が [mediabunny](https://mediabunny.dev/)（同作者）
- mediabunny: pure TypeScript・**ランタイム依存ゼロ**（deps は `@types/*` のみ）・
  MPL-2.0・tree-shakable（必要分だけで数十 kB オーダー、最小 ~5kB）。
  **.mov / .mp4 / .webm ほかの読み書き両対応**で、WebCodecs を内蔵抽象化した
  Conversion API を持つ:
  - コーデックが出力コンテナに適合すれば**無変換コピー（パススルー）**、必要なときだけ再エンコード
  - リサイズ（fit: contain 等）・fps 変換・ビットレート指定・`onProgress`（0–1）
  - 実行前に `isValid` / `discardedTracks`（`undecodable_source_codec` 等の理由つき）で
    可否が分かる → フォールバック判定に使える（§4.3）
- 保守状況: npm `mediabunny` latest 1.55.2（2026-08-21 公開）。直近 1 か月で 7 リリースと
  活発。**minimumReleaseAge（7日）の下では 1.54.0（2026-08-14）以降の「7日経過済み」
  最新版が入る**。条件を満たす

### 2.3 入力の読み取り（`<input capture>` で撮った動画）

- iPhone のカメラ撮影は H.264 または HEVC の .mov（音声 AAC）。**Safari は両方
  デコード可**。撮影した端末＝アップロードする端末である典型ケースは自己完結する
- 他端末由来のファイル（例: iPhone の HEVC .mov を PC の Chrome で投稿）は、Chrome の
  HEVC デコードがハードウェア依存（Chrome 107+ で広く可）。デコードできるかは
  mediabunny の変換前チェックで分かるので、不可なら §4.3 のフォールバックへ
- コンテナの解析（長さ・解像度の取得）は WebCodecs が無くても mediabunny の demux
  だけでできる → Firefox Android でも上限チェックは可能

### 2.4 ffmpeg.wasm（比較のみ・不採用）

- wasm コア約 31MB のダウンロードが最初の投稿前に必要
- シングルスレッドの実速度は「30 秒の 1080p → H.264 で数分」オーダー
  （[公式 FAQ・issue](https://ffmpegwasm.netlify.app/docs/performance/)）。VP9 はさらに遅い
- マルチスレッド化には SharedArrayBuffer ＝ **サイト全体に COOP/COEP が必要**。
  本アプリは `Markdown.tsx` と `VenueDetailPage.tsx` で YouTube の iframe 埋め込みを
  使っており衝突する
- WebCodecs 非対応環境（Firefox Android）だけのためにこの代償は見合わない → 不採用

### 2.5 Workers / R2 の制約

- リクエストボディ上限は **100MB**（Free/Pro プラン。
  [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)）。
  アプリ側のグローバル `bodyLimit`（`worker.ts`）は 8MB だったので、
  動画ルートだけ上限を広げた（§7.1）
- R2 の `get()` は `range` オプションに **`Headers` オブジェクトをそのまま渡せる**
  （[R2 Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)）。
  返る `R2ObjectBody` は `range`（実際に返した範囲）と `writeHttpMetadata()` を持つ。
  **206 / `Content-Range` / `Accept-Ranges` ヘッダの組み立ては Worker 側の責務**。
  現状のコードベースに Range 対応は一切ない（BGM の `<audio>` は全量ストリームで
  動いている）ので、動画配信ルートで新規に実装する（§7.2）

---

## 3. どこに投稿できるか・データの置き場所

**`event_photo` テーブルを「イベントのメディア」テーブルとして拡張し、動画を混ぜる。**
別テーブルは作らない。

理由（契約を 1 か所に保つ）:

- 公開範囲の SQL 断片 `PUBLIC_USER_PHOTO_COND`（`photos_public = 1 AND status =
  'published' AND admin_hidden_at IS NULL`）、コメント（`event_photo_comment`）、
  モデレーション（`admin_hidden_*`、#278）、削除権限（本人 or イベントスタッフ、#275）、
  出席チェック連動（#289）、アカウント削除時の purge — **これら全部が動画にもそのまま
  当てはまる**。別テーブルにするとこの全系統を二重化することになる
- #407 のメディアタブ・#315 のイベント年表・facets・ページングは `event_photo` を
  母集団にしており、単一テーブルなら**動画が自動的に同じ場所に並ぶ**（UNION 不要）
- 将来 #110（写真ごとの「参加者のみ公開」・プロフィール表示設定）が入るとき、
  同じテーブルなら動画も**自動的に追随**する

テーブル名が `event_photo` のまま動画を持つのは名前の負債だが、リネームは全リポジトリの
SQL 文字列に波及するので今回はやらない（やるなら別 issue で `event_media` への
リファクタリングとして）。

### 3.1 マイグレーション（`apps/server/migrations/0077_event_videos.sql`）

```sql
-- #408 動画投稿。event_photo を写真/動画共通のメディア行として拡張する。
ALTER TABLE event_photo ADD COLUMN kind TEXT NOT NULL DEFAULT 'photo'; -- 'photo' | 'video'
ALTER TABLE event_photo ADD COLUMN duration_ms INTEGER;  -- video のみ。表示用（クライアント申告値）
ALTER TABLE event_photo ADD COLUMN bytes INTEGER;        -- video のみ。容量把握用
ALTER TABLE event_photo ADD COLUMN mime TEXT;            -- video のみ。'video/webm' | 'video/mp4'
```

- 既存行はすべて `kind = 'photo'` のまま。索引は既存の
  `idx_event_photo_event(event_id, created_at)` / `idx_event_photo_user(user_id, created_at)`
  で足りる（一覧は kind 混在で時系列に出す）
- 写真は従来どおりメタ列を使わない（MIME は R2 `httpMetadata` のみ、現状踏襲）

---

## 4. クライアント側エンコードパイプライン

エンコード系は `apps/web/src/lib/video/` に分離した（`EventPhotos.tsx` に動画フローを
足すと 800 行を超えるため）:

- `plan.ts` — **`decideVideoPlan(support, probe, trim): VideoPlan`（純関数）**。
  ブラウザ能力（`VideoEncoder`/`AudioEncoder` の有無、`canEncode` の結果）と
  入力情報（コンテナ・コーデック・長さ・解像度・サイズ）から経路を決める。
  トリム範囲の正規化（`normalizeVideoTrim` / `moveVideoTrim`、#425）もここ。
  ユニットテストの主対象（§10）
- `probe.ts` — ブラウザ能力の実測（`detectVideoCapability`）と入力の demux
  （`probeVideoFile`）。demux 済みの結果は後段が使い回す（同じ File を2回解析しない）
- `encode.ts` — mediabunny の Conversion をラップ。進捗コールバックとキャンセルを公開。
  出力が `EVENT_VIDEO_MAX_BYTES` を超えたら送信せずに弾く（`video_output_too_large`）
- `poster.ts` — サムネイル切り出し（§5）

UI は `apps/web/src/components/` の `VideoUploadFlow`（フロー全体・キュー #427）・
`VideoSelectStep`（範囲選択）・`VideoTrimBar`（トリム #425）・`videoThumb`
（一覧のオーバーレイと配信 URL 組み立て）。実機計測用に `/dev/video-encode`
（`DevVideoEncodePage`。ナビに載せず URL 直打ちのみ）を検証用に維持している。

### 4.1 出力ターゲット

| 優先 | コンテナ | 映像 | 音声 | 条件 |
|---|---|---|---|---|
| 1 | WebM | VP9（`canEncode` 不可なら VP8） | Opus | VideoEncoder + AudioEncoder あり（Chrome/Edge/Firefox デスクトップ/Safari 26+） |
| 2 | MP4 | H.264 | AAC **パススルー**（入力が AAC のとき。再エンコードしない） | VideoEncoder のみ（Safari 16.4–18）。音声が AAC 以外で通せなければ「音声なしで投稿するか」確認 |
| 3 | そのまま | — | — | WebCodecs なし/デコード不可。入力が MP4/WebM かつ上限内に限る（§4.3） |

変換パラメータ（§6 の上限に対応）:

- 解像度: 長辺 1280 に収める（fit: contain 相当。元がそれ以下なら等倍）
- フレームレート: 30fps 上限
- ビットレート目標: VP9 ≈ 2.0Mbps / VP8・H.264 ≈ 2.5Mbps、音声 Opus 96kbps
- 入力のコーデックが既に出力条件を満たす場合（例: 720p 以下の VP9 WebM）は
  mediabunny が無変換コピーする（速い・劣化なし）

### 4.2 実行の流れ（2段階 #427）

1. ファイル選択（`accept="image/*,video/*"`。既存の `<input>` を拡張、§8）。
   動画は複数選択可で、全本が `VideoUploadFlow` のキューに入る
2. **第1段階: 範囲選択**（`VideoSelectStep` を1本ずつ。エンコードはまだしない）。
   mediabunny の demux でメタデータ取得（長さ・解像度・コーデック）→ 能力実測 →
   `decideVideoPlan` で経路決定。60秒超は必須でトリム UI（#425。枠の両端伸縮＋
   中身ドラッグ移動、上限60秒・最短1秒）で範囲を選ばせ、60秒以内は止まらず
   自動確定する（#427 実機FB）。音声を落とす経路だけは確認を挟む。
   変換できない環境/入力の60秒超は切り出せないため即エラー（端末側での編集を案内）
3. **第2段階: 処理**（確定した本を1本ずつ順に。並行しない）。
   Conversion 実行（`onProgress` で進捗表示）→ サムネイル切り出し（§5。選んだ
   範囲の中から）→ multipart で一括アップロード（§7.1）。`XMLHttpRequest` の
   `upload.onprogress` で進捗表示

### 4.3 フォールバック（経路 3 とエラー）

- **Firefox Android など WebCodecs なし**、または `discardedTracks` がデコード不可を
  示す入力（例: PC Chrome で HW HEVC デコーダなし）:
  - 入力が最初から `video/mp4` か `video/webm` で、**長さ・サイズが上限内**なら
    そのまま（無変換で）受ける。長さ・サイズの検査は demux だけでできる（§2.3）
  - それ以外（.mov、上限超過など）は諦めてエラー。「このブラウザでは動画を変換
    できません。60 秒以内の動画を別のブラウザからお試しください」系の文言
    （実装技術名は UI 文言に出さない）
- ffmpeg.wasm の遅延ロード代替は採用しない（§2.4）
- サムネイルが切り出せない環境（経路 3 と重なる）ではポスターなしを許容する
  （一覧はプレースホルダ表示、§8）。既知: 管理画面（adminModeration）の
  コンテンツ一覧はポスターなし動画で壊れた画像アイコンになる（判断には
  イベント側のギャラリーを開けば足りるため対応しない）

---

## 5. サムネイル（ポスター）

- クライアントで 1 フレーム切り出す。mediabunny の CanvasSink で、選んだ範囲
  （トリム #425。トリムなしなら全体）の先頭から 0.5 秒進めた地点（取れなければ
  範囲の先頭）のフレームを長辺 1600px に収めた canvas に描き、
  そこから直接 WebP（非対応なら JPEG）品質 0.8 で画像化する（canvas が既に
  手元にあるため `encodeImageForUpload` は通さない。同関数は <img> 経由の
  読み込みが前提で、ここでは二度手間になる）。1.5MB を超えたら品質 0.5 で
  再試行し、それでも収まらなければポスターなしで送る（超過したまま送ると
  本体を送り切った後に全体が 413 になるため、上限は送信前に担保する）。
  `<video>` + seek ではなく mediabunny を使うのは、
  変換と同じデコード経路なので「変換できるのにポスターだけ失敗」を避けられるため
  （`<video>` からの canvas 描画の先行例は `CheckinPage.tsx:346` の QR スキャン）
- 動画本体と同じ multipart リクエストで一緒に上げる（§7.1）。上限は写真と同じ
  `EVENT_PHOTO_MAX_BYTES`（1.5MB）
- 保存はコードベース初の「派生物」になる。キーは同一 prefix の兄弟に置く（§7.3）

---

## 6. 上限

| 項目 | 値 | 根拠 |
|---|---|---|
| 長さ | **60 秒** | 短尺クリップ想定（写真ギャラリーの延長）。60s × 2.1Mbps ≈ 16MB で転送・保存とも軽い |
| 解像度 | 長辺 **1280**（720p 相当） | スマホ画面での視聴に十分。エンコード時間も現実的（HW 支援ならほぼ実時間以下） |
| フレームレート | 30fps | 同上 |
| エンコード後サイズ | **40MB**（`EVENT_VIDEO_MAX_BYTES = 40 * 1024 * 1024`、`packages/shared/src/photos.ts` に追加） | 見積り: WebM ≈ 16MB / MP4 ≈ 20MB の 2 倍の余裕。フォールバック原本受け入れ（§4.3）もこの上限で自然に制限される。Workers の 100MB（§2.5）に対し十分な余裕 |
| イベントあたり本数 | 写真と共有の `EVENT_PHOTO_LIMIT = 50` 枠。動画専用の追加上限は設けない | 最悪 50 本 × 40MB = 2GB/イベント。R2 保存 $0.015/GB·月 → **$0.03/月/イベント**、egress 無料。上限を増やす複雑さに見合う節約がない |

コスト感: 1000 本（平均 15MB）で 15GB → 保存 約 $0.23/月。配信は R2 egress 無料 +
Workers リクエスト課金のみ。当面問題にならない。

---

## 7. API・保存・配信

### 7.1 アップロード

**`POST /api/events/:id/videos`**（`eventPhotoRoutes` に追加、`requireAuth` +
`requireEventRole(["participant","staff","judge","observer"])` — 写真と同一）

- **multipart/form-data**（`c.req.parseBody()`。先行例: `routes/bgm.ts`）:
  - `video`: File（`video/webm` | `video/mp4`）
  - `poster`: File（画像。既存 `normalizeImageMime` を通す）。省略可（§4.3 の環境向け）
  - `durationMs`: クライアント申告値（表示用。実効的なサイズ制限はバイト数上限が
    担保するが、欠落・非整数・上限超過の申告は `invalid_duration` 400 で弾く）
- multipart を選ぶ理由: 動画＋ポスターを **1 リクエストで原子的に**受けられ、
  「本体はあるがポスターがない」中間状態を API 上に作らない
- サーバ側検証（写真の流儀を踏襲し、順に弾く。読み込みが要るものを後ろに）:
  1. MIME 許可リスト: `apps/server/src/lib/videoMime.ts`（`video/webm` /
     `video/mp4`。`;codecs=` パラメータは正規化して落とす。`safeServeVideoMime` も同居）
  2. `EVENT_VIDEO_MAX_BYTES`・`durationMs ≤ EVENT_VIDEO_MAX_DURATION_MS`・
     ポスターの MIME とサイズ（`EVENT_PHOTO_MAX_BYTES`）・
     `EVENT_PHOTO_LIMIT`（写真と合算）
  3. **マジックバイト検査**: WebM は先頭 `1A 45 DF A3`（EBML）、MP4 は offset 4 に
     `ftyp`。画像より偽装リスクが高い（`<video>` 直配信）ので宣言 MIME だけを信じない
- 保存順序は **R2 put（video → poster）→ D1 insert**。写真（D1 → R2）と逆だが、
  大きいオブジェクトほど put 失敗の確率が上がるため「行はあるのに実体がない」壊れ方を
  避ける。ポスター put か D1 insert に失敗したら本体＋ポスターの2キーを
  best-effort で消す（行が無い動画は削除 API にも purge にも乗らない孤児になるため）
- **グローバル `bodyLimit`（8MB）の扱い**: `worker.ts` の 1 か所で、パスが
  `POST …/videos` のときだけ `maxSize` を `EVENT_VIDEO_MAX_BYTES + EVENT_PHOTO_MAX_BYTES
  + 余白(1MB)` に切り替える。門を 2 枚にしない（ルート側に別の bodyLimit を重ねない）

### 7.2 配信（Range 対応 — コードベース初）

**`GET /api/events/:id/photos/:photoId/video`**（公開 GET。`worker.ts` の photo image
ルートの隣に登録し、`canViewPhotos` で写真と同じ可視性判定。`kind !== "video"` の
行は 404 で動画配信ルートに乗せない）

- `Range` は R2 に Headers を丸投げせず、**Worker 側の `parseByteRange` で自前解釈**
  する（単一範囲のみ）。満たせない範囲で throw する R2 の仕様にエラー処理を
  委ねると分岐が読めなくなるため。`Range` があるときは先に `head` でサイズを取る
- 文法不正・複数範囲 → RFC 9110 に従い無視して **200 全量**。
  満たせない範囲（開始がサイズ以上等） → **416** + `Content-Range: bytes */total`
- 正しい `Range` → **206** + `Content-Range: bytes start-end/total` + 部分 body
- 条件付きヘッダ（`If-None-Match` 等）があるときだけ `onlyIf` を渡し、
  前提条件が満たされなければ body なし → **304**
  （event cover image の既存 ETag 実装が先行例）
- `Range` なし → 200 + 全量ストリーム
- 常時: `Accept-Ranges: bytes`、`ETag: obj.httpEtag`、
  `Content-Type: safeServeVideoMime(...)`、`X-Content-Type-Options: nosniff`、
  `Cache-Control: private, max-age=3600`（写真と同じ。可視性判定つき配信のため public
  にしない）
- iOS Safari は `<video>` 再生でまず Range を投げるため、**206 対応は必須**（任意ではない）

**`GET /api/events/:id/photos/:photoId/poster`** — 写真の image 配信と同型
（`safeServeMime` + nosniff + private cache）。ポスター未登録なら 404
（クライアントがプレースホルダを出す）

### 7.3 R2 キー

```
event-videos/${eventId}/${videoId}          … 動画本体
event-videos/${eventId}/${videoId}-poster   … ポスター画像
```

- 既存の作法（prefix/イベントID/オブジェクトID、拡張子なし）に合わせる。写真の
  `event-photos/` はそのまま触らない
- **`purgeDeleted.ts` の `collectUserObjects()` に動画分を追加する**（`listIdsByUser` に
  kind を持たせ、video 行は本体＋poster の 2 キーを列挙）。削除 API
  （`DELETE /:id/photos/:photoId` を kind 不問で流用）も同様に 2 オブジェクト消す

### 7.4 一覧系 API・型

新しい一覧エンドポイントは作らない。既存に `kind` を足す:

- `eventPhotoSchema` / `userPhotoSchema` / `timelinePhotoSchema`（`packages/shared/src/photos.ts`）
  に `kind: "photo" | "video"` と `durationMs?: number` を追加
- `GET /api/events/:id/photos`・`GET /public/users/:handle/photos`（メディアタブ）・
  年表の photos は kind 混在でそのまま返る（リポジトリの SELECT に列を足すだけ。
  `PUBLIC_USER_PHOTO_COND` は共有断片なので公開範囲は自動的に一致する）

---

## 8. 画面

- **投稿**: `EventPhotos.tsx` の `<input>` を `accept="image/*,video/*"` にし、動画
  ファイルは `VideoUploadFlow`（別コンポーネント。遅延ロード）に渡す。
  ドラッグ&ドロップも同じ分岐。**複数選択可**で、動画は全本がキューに入り
  §4.2 の2段階で直列処理する（#427）。写真と混在したら写真は従来どおり処理し、
  動画はキューへ。フロー実行中に追加選択された動画は、いまのフローが
  閉じてから続けて処理する
- **進捗**: ダイアログに 1 本のプログレスバー。エンコード（mediabunny `onProgress`）を
  0–70%、アップロード（XHR `upload.onprogress`）を 70–100% に割り付ける。写真の
  「枚数カウントのみ」と違い、分オーダーになり得るため割合表示は必須。
  「この動画を中止（次へ進む）」で Conversion / XHR を中断でき、
  「すべてキャンセル」も置く。ボタン行はスマホ幅で折り返す（#427 実機崩れ、PR #429）
- **途中離脱・失敗**: サーバに中間状態を作らない（§7.1 の原子性）ので、
  失敗＝何も残らない＝**最初からやり直しが正**。キューも永続化しない（タブを
  閉じたら消える。40MB×複数本の中間データを保存する価値がない）。失敗した本は
  最後にまとめ画面へ理由つきで出す。50枠切れ（`photo_limit`）が出たら以降も
  同じ結果になるので残りを中止する。resumable/multipart アップロードは
  40MB 上限では過剰なのでやらない
- **一覧（イベントギャラリー・メディアタブ・年表）**: ポスター画像を写真と同じ
  グリッドに出し、再生アイコンと `0:42` 形式の長さバッジを重ねる。タップで
  ライトボックス（既存 Dialog）内に
  `<video controls playsInline preload="metadata" poster=…>` を出す。自動再生はしない
- ポスターなし動画はグレー地＋再生アイコンのプレースホルダ

## 9. 公開範囲

写真と完全に同じ規則（新しい規則を作らない）:

- イベントギャラリー: `photosPublic && published` なら誰でも / それ以外はイベント
  メンバー（confirmed、出席チェック連動 #289）とサイト管理者
- 公開プロフィール（メディアタブ）: `PUBLIC_USER_PHOTO_COND` 断片を共有しているため
  同一（§7.4）
- モデレーション（#278 admin_hidden）・削除権限（#275 本人 or イベントスタッフ）も
  行が同じテーブルなのでそのまま効く
- **#110（写真ごとの参加者限定公開・プロフィール表示設定）は未実装・open**。
  リポジトリ内に参照はまだない。実装されるとき、動画は同じテーブル・同じ SQL 断片に
  乗っているので**個別対応なしで追随する**（本設計が単一テーブルを選ぶ理由の一つ）

## 10. テスト

**線引き: エンコード（WebCodecs）はブラウザ実装依存なので実機で見る。それ以外
（経路決定・サーバの門・配信）はユニットで固める。**

ユニット（server、vitest-pool-workers。実 D1/R2 バインディングで動く既存流儀。
`event-videos.test.ts`）:

- アップロードの門: MIME 許可リスト・マジックバイト・サイズ上限・長さの申告・
  ポスター上限・本数上限・bodyLimit の拡張が動画ルートだけであること・
  ロール要件・非メンバー拒否
- **Range**: 200 全量 / 206 + `Content-Range` の境界値（先頭・末尾・suffix）/ 416 /
  `If-None-Match` 304 / `Accept-Ranges` ヘッダ / 写真の id に `/video` を叩いても 404
- 公開範囲: `photos_public` オフのイベントの動画が漏れない。公開プロフィール側は
  `profile-photos-paging.test.ts` の kind 混在ケース
- purge: 退会時に動画本体＋poster の 2 キーが消える（`account-deletion.test.ts`）
- 削除 API: 動画で R2 が 2 オブジェクト消えること

ユニット（web）:

- `decideVideoPlan` のマトリクス（`plan.test.ts`）: （WebCodecs フル / video のみ /
  なし）×（WebM 入力 / H.264 mov / HEVC mov / 上限超過）→ 期待経路（WebM /
  MP4+AAC パススルー / 音声なし確認 / そのまま受理 / エラー）を全列挙。
  トリムの正規化（`normalizeVideoTrim` / `moveVideoTrim`）もここ
- コンポーネント: `encode.test.ts` / `VideoSelectStep.test.tsx` /
  `VideoTrimBar.test.tsx` / `VideoUploadFlow.test.tsx`・`VideoUploadFlow.reinit.test.tsx` /
  `EventPhotos.queue.test.tsx`・`EventPhotos.video.test.tsx` / `videoThumb.test.tsx`

実機（手動マトリクス。リリース前チェックリストとして本書に紐づける）:

- iPhone (iOS 26 / Safari): カメラ撮影 HEVC .mov → WebM 変換・投稿・再生・シーク
- iPhone (iOS 18 系 / Safari): 同入力 → MP4 (H.264 + AAC パススルー) 経路
- Android Chrome: 撮影 → WebM（VP9 か VP8 かを `canEncode` 実測で確認。§2.1 の注記）
- デスクトップ Chrome / Firefox: HEVC .mov 投稿（HW デコーダなし機で §4.3 の
  フォールバック文言が出ること）
- Firefox Android: MP4 そのまま受理経路とエラー文言
- 保存済み WebM の iOS 15–18 実機での再生（§1 の再生互換の裏取り）
- 60 秒 720p のエンコード所要時間の実測（進捗配分 70/30 の妥当性確認）

## 11. 設計からの差分

レビュー・実機フィードバックで設計から変えた判断（いずれもコード/PR で確認済み）:

- **トリミング UI の追加**（issue #425 → PR #426）: 設計時は「60秒超は端末側での
  編集を案内してエラー」だったが、枠の両端伸縮＋中身ドラッグのトリム UI を追加した
  （§4.2）。変換経路のみ・上限60秒・最短1秒。素通し経路は切り出せないので従来どおり
  エラー。ポスターも選んだ範囲の中から切り出す（§5）
- **複数本アップロードのキュー直列化**（issue #427 → PR #428）: 設計は
  「1回の操作で1本のみ」。実装後の実機フィードバックで複数選択を受けるよう変え、
  **範囲選択を全本先に済ませてから、1本ずつ順に変換→アップロード**の2段階にした
  （§4.2、§8）。demux 結果は両段階で使い回し、同じ File を2回解析しない
- **60秒以内は範囲選択ステップを出さず自動確定**（#427 実機FB → PR #430）:
  「短い動画も任意でトリム」は、キューの全本で決定タップを要求する代償に
  見合わないため落とした。音声を落とす経路だけは確認を挟む
- **ダイアログのボタン行をスマホ幅で折り返す**（#427 実機崩れ → PR #429）
- **「アップロードだけの失敗は再エンコードなしで再送」はやめた**: キュー化に伴い、
  失敗した本はまとめ画面に理由を出して最初からやり直す方式にした（§8）。
  キューは永続化しない
- **レビュー対応**（PR #423 内）: ポスター put 失敗時も含め R2 の2キーを best-effort
  で掃除して孤児を防ぐ（§7.1）、アップロードを `AbortController` で中断できるように、
  ポスターは送信前に上限 1.5MB を担保（品質 0.8 → 0.5 で再試行。§5）
- **`durationMs` のサーバ検証**: 設計は「表示用のみ」だったが、欠落・非整数・
  明らかな超過申告は `invalid_duration` で弾く（§7.1。実効的な制限はバイト数のまま）
- **Range の解釈は Worker 側で自前パース**: R2 の `get(key, { range: headers })` に
  委ねる案から、`parseByteRange` での判定に変えた（§7.2）
- **`caption` パラメータは無し**: 写真の投稿にキャプションが無いのに合わせ、
  動画にも付けなかった（§7.1）
- **エンコード出力の 40MB 超はクライアント側でも送信前に弾く**
  （`video_output_too_large`。§4）

実装 PR: #422（変換パイプライン＋実機計測ページ）→ #423（アップロード・保存・表示）
→ #426 → #428 → #429 → #430。各 PR は独立レビュー・staging 確認を経た（既存フロー）。

## 12. やらないこと

- **サーバ側の変換・トランスコード**（Workers では不可能。前提）
- **外部の動画配信・変換サービスとの連携**（コスト・依存が増える。R2 直配信で足りる）
- **編集機能**（フィルタ・BGM 合成など。トリムだけは #425 で実装済み:
  変換経路のみ・両端選択・上限60秒。素通し経路の 60 秒超は端末側編集を促す）
- **ffmpeg.wasm**（§2.4）
- **resumable / multipart アップロード**（40MB では過剰）
- **HLS/DASH などのアダプティブ配信・ストリーミング録画**（`<video>` + Range 直配信で十分）
- **既存写真のサムネイル最適化**（README 記載の Image Transformations 構想は別件のまま）
- **AV1**（Safari エンコード不可・エンコード負荷が高い。将来コーデック優先度に足すだけで済む設計）
