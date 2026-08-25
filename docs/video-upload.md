# 動画を投稿できるようにする (#408)

- 対象: `apps/web`（エンコードパイプライン・投稿 UI・ギャラリー/メディアタブ表示）、
  `apps/server`（アップロード/配信 API・Range 対応・purge）、`packages/shared`（型・定数）
- 前提: #407（プロフィールのタブ化・メディアタブ）はマージ済み。メディアタブは
  「動画が増えても収まる命名・構造にする」前提で作られている（`docs/profile-tabs.md` §11）
- 決定済み（issue コメント 2026-08-26）: **保存形式は WebM を狙う**。
  **ブラウザ内でエンコードしてからアップロード**（Workers ではトランスコード不可）。
  方式は WebCodecs 優先で検討し、ffmpeg.wasm と比較して決める
- 本書は調査と設計のみ。実装は含まない

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
  現状のアプリ側 `bodyLimit` は 8MB（`apps/server/src/worker.ts:113-120`）なので、
  動画ルートだけ上限を広げる必要がある（§7.1）
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
ALTER TABLE event_photo ADD COLUMN duration_ms INTEGER;  -- video のみ。表示用（クライアント申告）
ALTER TABLE event_photo ADD COLUMN bytes INTEGER;        -- video のみ。容量把握用
ALTER TABLE event_photo ADD COLUMN mime TEXT;            -- video のみ。'video/webm' | 'video/mp4'
```

- 既存行はすべて `kind = 'photo'` のまま。索引は既存の
  `idx_event_photo_event(event_id, created_at)` / `idx_event_photo_user(user_id, created_at)`
  で足りる（一覧は kind 混在で時系列に出す）
- 写真は従来どおりメタ列を使わない（MIME は R2 `httpMetadata` のみ、現状踏襲）

---

## 4. クライアント側エンコードパイプライン

新規ディレクトリ `apps/web/src/lib/video/` に置く（`EventPhotos.tsx` は既に 595 行あり、
動画フローを足すと 800 行を超えるため、最初から分離する）:

- `plan.ts` — **`decideVideoPlan(support, probe): VideoPlan`（純関数）**。
  ブラウザ能力（`VideoEncoder`/`AudioEncoder` の有無、`canEncode` の結果）と
  入力情報（コンテナ・コーデック・長さ・解像度・サイズ）から経路を決める。
  ユニットテストの主対象（§10）
- `encode.ts` — mediabunny の Conversion をラップ。進捗コールバックとキャンセルを公開
- `poster.ts` — サムネイル切り出し（§5）

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

### 4.2 実行の流れ

1. ファイル選択（`accept="image/*,video/*"`。既存の `<input>` を拡張、§8）
2. mediabunny の demux でメタデータ取得（長さ・解像度・コーデック）。
   **長さ > 上限なら即エラー**（トリミング UI は作らない。§12）
3. `decideVideoPlan` で経路決定。変換系なら Conversion 実行（`onProgress` で進捗表示）
4. サムネイル切り出し（§5）
5. multipart で一括アップロード（§7.1）。`XMLHttpRequest` の `upload.onprogress` で進捗表示

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
  （一覧はプレースホルダ表示、§8）

---

## 5. サムネイル（ポスター）

- クライアントで 1 フレーム切り出す。mediabunny の frame sink で先頭付近
  （0.5 秒地点、なければ先頭）のフレームを canvas に描き、既存の
  `encodeImageForUpload`（`apps/web/src/lib/encodeImage.ts`、1600px・WebP・
  品質 0.8）を通して画像化する。`<video>` + seek ではなく mediabunny を使うのは、
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
  - `durationMs`: クライアント申告値（表示用。真の制限はバイト数で担保）
  - `caption`: 省略可（写真と同じ扱い）
- multipart を選ぶ理由: 動画＋ポスターを **1 リクエストで原子的に**受けられ、
  「本体はあるがポスターがない」中間状態を API 上に作らない
- サーバ側検証（写真の流儀を踏襲し、順に弾く）:
  1. MIME 許可リスト: 新設 `apps/server/src/lib/videoMime.ts`（`video/webm` /
     `video/mp4`。`;codecs=` パラメータは正規化して落とす。`safeServeMime` 相当も同居）
  2. **マジックバイト検査**: WebM は先頭 `1A 45 DF A3`（EBML）、MP4 は offset 4 に
     `ftyp`。画像より偽装リスクが高い（`<video>` 直配信）ので宣言 MIME だけを信じない
  3. `EVENT_VIDEO_MAX_BYTES`、`EVENT_PHOTO_LIMIT`（写真と合算）、`durationMs ≤ 60_000`
- 保存順序は **R2 put（video → poster）→ D1 insert**。写真（D1 → R2）と逆だが、
  大きいオブジェクトほど put 失敗の確率が上がるため「行はあるのに実体がない」壊れ方を
  避ける。D1 insert 失敗時は best-effort で R2 を消す
- **グローバル `bodyLimit`（8MB）の扱い**: `worker.ts` の 1 か所で、パスが
  `POST …/videos` のときだけ `maxSize` を `EVENT_VIDEO_MAX_BYTES + EVENT_PHOTO_MAX_BYTES
  + 余白(1MB)` に切り替える。門を 2 枚にしない（ルート側に別の bodyLimit を重ねない）

### 7.2 配信（Range 対応 — コードベース初）

**`GET /api/events/:id/photos/:photoId/video`**（公開 GET。`worker.ts` の photo image
ルートの隣に登録し、`canViewPhotos` で写真と同じ可視性判定）

```
obj = bucket.get(key, { range: request.headers, onlyIf: request.headers })
```

- `If-None-Match` 一致 → 304（event cover image の既存 ETag 実装が先行例）
- `Range` あり → **206** + `Content-Range: bytes start-end/total` + 部分 body
  （`obj.range` から組み立て）。不正な範囲は 416
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
  ファイルは新設の `VideoUploadFlow`（別コンポーネント）に渡す。ドラッグ&ドロップも
  同じ分岐。動画は 1 回の操作で 1 本のみ（写真の複数選択と混在したら写真だけ処理して
  動画は 1 本目のみ受ける）
- **進捗**: ダイアログに 1 本のプログレスバー。エンコード（mediabunny `onProgress`）を
  0–70%、アップロード（XHR `upload.onprogress`）を 70–100% に割り付ける。写真の
  「枚数カウントのみ」と違い、分オーダーになり得るため割合表示は必須。キャンセル
  ボタンで Conversion を中断できる
- **途中離脱・失敗時の再開**: サーバに中間状態を作らない（§7.1 の原子性）ので、
  失敗＝何も残らない＝**最初からやり直しが正**。ただしエンコード済み Blob は
  ダイアログを閉じるまでメモリに保持し、アップロードだけの失敗（電波切れ等）は
  **再エンコードなしで再送**できるようにする。resumable/multipart アップロードは
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

ユニット（server、vitest-pool-workers。実 D1/R2 バインディングで動く既存流儀）:

- アップロードの門: MIME 許可リスト・マジックバイト・サイズ上限・本数上限・
  ロール要件・非メンバー拒否（既存 `photos-attendance.test.ts` の並び）
- **Range**: 200 全量 / 206 + `Content-Range` の境界値（先頭・末尾・suffix）/ 416 /
  `If-None-Match` 304 / `Accept-Ranges` ヘッダ
- 公開範囲: `photos_public` オフのイベントの動画が公開プロフィールに漏れない
  （既存 `profile-photos-paging.test.ts` に kind 混在ケースを追加）
- purge: 削除ユーザーの動画本体＋poster の 2 キーが列挙される
- 削除 API: 動画で R2 が 2 オブジェクト消えること

ユニット（web、純関数）:

- `decideVideoPlan` のマトリクス: （WebCodecs フル / video のみ / なし）×（WebM 入力 /
  H.264 mov / HEVC mov / 上限超過）→ 期待経路（WebM / MP4+AAC パススルー / 音声なし
  確認 / そのまま受理 / エラー）を全列挙

実機（手動マトリクス。リリース前チェックリストとして本書に紐づける）:

- iPhone (iOS 26 / Safari): カメラ撮影 HEVC .mov → WebM 変換・投稿・再生・シーク
- iPhone (iOS 18 系 / Safari): 同入力 → MP4 (H.264 + AAC パススルー) 経路
- Android Chrome: 撮影 → WebM（VP9 か VP8 かを `canEncode` 実測で確認。§2.1 の注記）
- デスクトップ Chrome / Firefox: HEVC .mov 投稿（HW デコーダなし機で §4.3 の
  フォールバック文言が出ること）
- Firefox Android: MP4 そのまま受理経路とエラー文言
- 保存済み WebM の iOS 15–18 実機での再生（§1 の再生互換の裏取り）
- 60 秒 720p のエンコード所要時間の実測（進捗配分 70/30 の妥当性確認）

## 11. 実装順（PR 分割案）

1. **server + shared**: migration 0077・型に `kind`/`durationMs`・upload/serve
   （Range）・purge・ユニットテスト一式。この時点で API は完成し curl で通る
2. **web パイプライン**: mediabunny 導入・`lib/video/`（plan/encode/poster）・
   `decideVideoPlan` テスト・投稿 UI と進捗ダイアログ
3. **web 表示**: ギャラリー/メディアタブ/年表のポスター表示・ライトボックス再生・文言

各 PR は独立レビュー・staging 確認を経る（既存フロー）。

## 12. やらないこと

- **サーバ側の変換・トランスコード**（Workers では不可能。前提）
- **外部の動画配信・変換サービスとの連携**（コスト・依存が増える。R2 直配信で足りる）
- **編集機能**（トリミング・フィルタ・BGM 合成など。60 秒超は再撮影/端末側編集を促す）
- **ffmpeg.wasm**（§2.4）
- **resumable / multipart アップロード**（40MB では過剰）
- **HLS/DASH などのアダプティブ配信・ストリーミング録画**（`<video>` + Range 直配信で十分）
- **既存写真のサムネイル最適化**（README 記載の Image Transformations 構想は別件のまま）
- **AV1**（Safari エンコード不可・エンコード負荷が高い。将来コーデック優先度に足すだけで済む設計）
