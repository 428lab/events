# Bluesky でログイン・連携 (#381)

- 対象: `apps/server`（認証）・`apps/web`（ログイン画面・アカウント設定）・D1 スキーマ
- 範囲: **ログインと連携だけ。投稿は範囲外**（したがってトークンを保存しない）
- ステータス: 設計（実装は別 PR）。**スパイク通過済み（4.2）。実装に入ってよい**

---

## 1. なぜ既存の OAuth 共通化に乗らないか

既存の OAuth は `apps/server/src/auth/providers.ts` の `ProviderConfig` に集約されている。
契約は実質2つのメソッドしかない。

- `exchange(code, redirectUri, verifier) → access_token`
- `fetchProfile(token) → OAuthProfile`

AT Protocol の OAuth はこの2つでは表現できない。差分は次のとおり。

| 既存の前提 | AT Protocol |
|---|---|
| 接続先（authorize / token の URL）はプロバイダごとに固定 | **利用者ごとに解決する**。ハンドル → DID → PDS → 認可サーバーで外部 fetch が3〜5回。PDS と認可サーバーは別ホストなので `/.well-known/oauth-protected-resource` を必ず経由する |
| 事前登録した `client_id` / `client_secret` を使う | **事前登録が無い**。`client_id` は自分が公開する `client-metadata.json` の URL そのもの |
| authorize URL にパラメータを並べて redirect | **PAR 必須**。パラメータは先にサーバーへ POST し、返ってきた `request_uri` だけを URL に載せる |
| Bearer トークン | **DPoP 必須**。ログイン試行ごとに ES256 鍵を作り、サーバーが返す nonce を貼り直す |
| コールバックは `code` と `state` | さらに **`iss` の検証が必須**。交換後に DID を再解決して「その認可サーバーがその DID の権威か」を確かめる義務がある |
| プロバイダの数値 ID が識別子 | **`sub` は DID**。ハンドルは可変なので識別子にしてはいけない |

`ProviderConfig` を拡張してこれを吸収しようとすると、Bluesky でしか使わない分岐が
共通経路に入り込み、既存4プロバイダの読みやすさを損なう。
**Nostr (`auth/nostr.ts`) と同じ位置づけ——独立モジュール＋専用ルート——にする。**

---

## 2. 先行実装（aozoraquest）から分かったこと

`github.com/kojira/aozoraquest`（同じオーナー、Cloudflare Workers + Bluesky OAuth）を読んだ。
**本設計の根拠のうち、実機で動いていることが確認できるものはこのリポジトリ由来である。**

### 2.1 動いているのはブラウザ側の public client

- `apps/web/src/lib/oauth.ts` — `@atproto/oauth-client-browser` を使用
- `apps/web/vite.config.ts` — 本番の client metadata は
  `token_endpoint_auth_method: 'none'` / `dpop_bound_access_tokens: true` /
  `application_type: 'web'` / `client_id` は `${APP_URL}/client-metadata.json`

**つまり「鍵を持たない public client の web クライアント」で本番運用できている。**
これが本設計で confidential client を採らない最大の根拠。

### 2.2 Worker 側（サーバー側）の OAuth は未実装

- `apps/edge/src/oauth-probe.ts` — `@atproto/oauth-client-node` が Workers で
  **import 評価時に落ちる**ことを確認した PoC。原因は
  内部依存 undici の `process.env.NODE_DEBUG.split(',')`。
- `docs/15-user-quest.md` — その結論を受けて
  「`@atproto/oauth-client`(core) を Web Crypto + fetch で自前 adapter する」方針が書かれているが、
  該当実装は無い。

**したがって「core が workerd で動く」ことの実機証拠はまだ無い。** 第4章のスパイクが必要な理由。
**→ 4.2 で確認した。core は workerd で動く。**

### 2.3 その他、拾った実測

- `apps/web/src/lib/oauth.ts` — 開発は localhost 例外を使う。
  `client_id` は `http://localhost?redirect_uri=...`、**`redirect_uri` は `127.0.0.1`**（RFC 8252）。
  ブラウザも 127.0.0.1 で開かないと認可後に戻れない。
- `apps/web/src/lib/follows-resonance.ts` — 認証済みセッションで公開データを読むと
  **DPoP nonce の競合と CORS 不安定で実測1時間ほどで連続失敗**した。公開 AppView を使え、という記録。
  → 本設計が「トークンを捨てて、プロフィールは公開 API で取る」ことの裏付け。
- `apps/web/src/lib/session.ts` — 復元直後の PDS が 401 を返すことがある、
  並行リクエストの token refresh が競合する、といった運用上の罠が記録されている。
  我々はトークンを持たないのでこれらは構造的に発生しない。

### 2.4 実例と違える判断

| 項目 | aozoraquest | 本設計 | 理由 |
|---|---|---|---|
| フローを回す場所 | ブラウザ | **Worker** | 我々は自前のセッション（D1 の `session`）を発行する。ブラウザで完結させると DID を我々のサーバーに証明できない（3.2 参照） |
| client metadata | ビルド時に静的生成 | **Worker のルートで動的生成** | eventer は Worker が SPA も配信し `APP_BASE_URL` が `wrangler.toml` にある。ビルド時環境変数を増やすより素直 |
| ハンドル解決 | `https://bsky.social` の XRPC | **DoH（DNS TXT + `.well-known`）** | 仕様に忠実で単一ベンダーに依存しない。ライブラリ同梱で fetch だけで動く。XRPC は代替（DoH が実機で通ったので採らない——4.2） |
| トークン | 保持・refresh | **保存しない** | 範囲がログインと連携だけ |

---

## 3. 決めたこと（結論）

1. **public client にする。**`token_endpoint_auth_method: 'none'`。
   クライアント鍵・`jwks.json`・鍵ローテーション・**追加シークレットはすべて不要**。
2. **フローはサーバー（Worker）で回す。** ライブラリは
   `@atproto/oauth-client`（ランタイム非依存の core）。`@atproto/oauth-client-node` は使わない。
3. **識別子は DID。** `identity` テーブルに `provider='bluesky'`, `provider_user_id=<DID>` で入れる。
   **DB の列追加は不要**（`UNIQUE(provider, provider_user_id)` がそのまま効く）。ハンドルは識別子にしない。
4. **トークンは交換後すぐ捨てる。** 表示名とアイコンは認証不要の公開 API から取る。
   リフレッシュも有効期限管理も存在しない。
5. **引き取りの規則は既存と同じ。** `takeoverEmptyAccount()` をそのまま使う。
6. **公開エンドポイントは `client-metadata.json` の1本だけ**、`/api/auth/bluesky/` 配下に置く。
   staging ゲートは `/api/auth/` を既に免除しているので**許可リストは触らない**。
7. **state は D1 の新テーブル**（TTL 10分）＋ **ブラウザ紐付け用 cookie**。
8. **`redirect: 'error'` の回避策は2枚**（fetch ラッパ＋自前 `didResolver`）。
   どちらも上流バグの回避策として、消せる条件つきで隔離する（8章。4.2 の実測で確定）。

### 3.1 なぜ public client でよいか

confidential client（`private_key_jwt`）の利点はセッション寿命だが、
**我々はトークンを1秒も持たない**ので利点がゼロになる。
一方コストは実在する: ES256 秘密鍵のシークレット管理、`jwks.json` の公開、
**認可サーバー側のメタデータキャッシュ TTL が仕様上不定**なため鍵ローテーションの
安全な手順が読み切れないこと。

将来 投稿機能を足すときは confidential へ移る必要がある（そのときの手順は16章）。
**保存済みセッションが存在しないので、移行で壊れるものが無い**——これも public を先に選ぶ理由。

### 3.2 なぜブラウザ側で完結させないか（却下した案）

aozoraquest の形（ブラウザが public client として認可を受ける）をそのまま真似ると、
ブラウザは DID と DPoP バインドされたトークンを持つが、**それを我々のサーバーに証明できない**。

- DPoP バインドのトークンを Bearer として転送しても、秘密鍵はブラウザにあるので
  サーバーは PDS に対して使えない。
- 証明する正攻法は `com.atproto.server.getServiceAuth`（アカウントの鍵で署名された
  audience 限定 JWT）だが、これは `transition:generic`（＝アプリパスワード相当の全書き込み権限）
  を要求することになる。**ログインしたいだけで全書き込み権限を求めるのは筋が悪い。**
- 粒度の細かい scope が策定中なので、将来これが `atproto` + 小さな scope で
  できるようになる可能性はある。そのときに再検討する。

よって**サーバーで認可コードを交換する**。これは既存4プロバイダと同じ形でもある。

---

## 4. 最初に実機で確かめること（スパイク）

**ここが崩れると方式ごと変わる。実装より先に、この順で確かめる。**
確認は `wrangler dev` に一時的な probe ルートを置いて行う
（aozoraquest の `apps/edge/src/oauth-probe.ts` と同じやり方。probe は本実装前に消す）。

| # | 確かめること | 落ちたときの分岐 |
|---|---|---|
| S1 | `@atproto/oauth-client` が workerd で **import 評価を通る**か（`core-js/es/symbol/dispose.js` を引いている） | 自前実装へ（4.1） |
| S2 | **fetch ラッパで `redirect: 'error'` を回避できる**か。実アカウントで `wrangler dev`（127.0.0.1）から最後までログインできるか | 自前実装へ |
| S3 | バンドルサイズと起動 CPU。`wrangler deploy --dry-run --outdir` で計測。**Workers の 1MB（圧縮後）上限**に対する余裕 | 自前実装へ（依存が桁違いに小さい） |
| S4 | DPoP 鍵の JWK 往復（`extractable: true` で生成 → `key.privateJwk` → `JoseKey.fromJWK`）が認可開始とコールバックを跨いで成立するか | 鍵の持ち方を変える（PKCS#8 で持つ等） |
| S5 | サーバー供給 nonce の貼り直しが期待どおり1往復で決まるか（PAR とトークン交換の両方） | ラッパで nonce を明示的に扱う |

### 4.1 自前実装に切り替える場合（Plan B）

public client のログイン専用フローは、仕様が明確なので自前でも書ける（見積り約300行）。

1. ハンドル解決（DoH の TXT `_atproto.<handle>` → 失敗したら `https://<handle>/.well-known/atproto-did`）
2. DID 解決（`did:plc` は `https://plc.directory/<did>`、`did:web` は `/.well-known/did.json`）
3. DID ドキュメントの `service` から PDS を取り、`/.well-known/oauth-protected-resource` →
   `authorization_servers[0]` → `/.well-known/oauth-authorization-server`
4. WebCrypto で ES256 鍵を生成し DPoP proof を作る（nonce 400 で1回リトライ）
5. PAR → authorize へ redirect
6. コールバック: `iss` 照合、PKCE verifier つきでトークン交換
7. `sub`（DID）を再解決して PDS → 認可サーバーの対応と `issuer` 一致を確認

Plan B に倒す場合も、**5章以降のモジュール分割・state の持ち方・ルート・UI・引き取り規則は変わらない**。
差し替わるのは `auth/bluesky/client.ts` の中身だけ。この境界を保つように書く。

### 4.2 スパイクの結果（2026-08-13 実測）

**結論: ライブラリ方式で進める。Plan B（4.1）は採らない。** ただし
**8章の fetch ラッパの想定は誤っていた**ので、8章を実測に合わせて書き直した（下記「S2 の詳細」）。

計測環境: `wrangler dev`（wrangler 4.85.0 / ローカル workerd / `nodejs_compat`）に
使い捨ての probe worker を置いて実行。probe は本ブランチにコミットしない。

使ったパッケージ（`apps/server` の直接依存として追加）:

| パッケージ | 版 |
|---|---|
| `@atproto/oauth-client` | 0.8.2 |
| `@atproto/jwk-webcrypto` | 0.3.4 |
| `@atproto/jwk-jose` | 0.2.4 |
| `@atproto-labs/handle-resolver` | 0.4.8 |

**0.8.3 が出ているが `minimumReleaseAge`（7日）が効いて 0.8.2 が入った。**
主な推移依存: `@atproto-labs/did-resolver` 0.3.7 / `@atproto-labs/fetch` 0.3.5 /
`@atproto-labs/identity-resolver` 0.4.7 / `@atproto/jwk` 0.7.4 /
`@atproto/oauth-types` 0.7.5 / `jose` 5.10.0 / `core-js` 3.50.0。

| # | 結果 | 要点 |
|---|---|---|
| S1 | **通った** | `import 'core-js/es/symbol/dispose.js'` は `nodejs_compat` 下の workerd で評価を通る。`@atproto/oauth-client-node` が落ちた原因（undici の `process.env.NODE_DEBUG`）は core には無い |
| S2 | **通った（ただし回避策の形が変わる）** | ハンドル → DID → PDS → 認可サーバー → PAR → authorize URL まで実在ハンドル2件で通した |
| S3 | **通った** | gzip 後 +76.7 KiB。上限に対して桁で余裕 |
| S4 | **通った** | `extractable: true` → `privateJwk` → `JoseKey.fromJWK` で同じ鍵に戻る |
| S5 | **通った** | PAR は 400（`use_dpop_nonce`）→ 貼り直して 201。**1往復で決まる** |

#### S2 の詳細（本丸）

**8章の「fetch ラッパで吸収する」は成立しない。** workerd は
`redirect: 'error'` を **`new Request()` の構築時点で** 拒否する。
`fetch()` を呼ぶ前に落ちるので、注入した fetch には制御が渡ってこない。

```
TypeError: Invalid redirect value, must be one of "follow" or "manual"
("error" won't be implemented since it does not make sense at the edge;
 use "manual" and check the response status code).
```

そして `@atproto-labs/fetch` の `bindFetch()` は、**注入した fetch を呼ぶ前に**
`asRequest(input, init)`（＝ `new Request(url, { redirect: 'error', ... })`）を実行する。
素の fetch を渡した probe（対照）の生の出力:

```
TypeError: Invalid redirect value, must be one of "follow" or "manual" ...
    at asRequest (.../bluesky.js:8542:10)
    at DidPlcMethod.fetch (.../bluesky.js:8535:42)
    at DidPlcMethod.resolve (.../bluesky.js:8954:17)
    at DidResolverCommon.resolve (.../bluesky.js:8916:40)
  → Error: Failed to resolve identity: bsky.app
```

つまり**経路によって効く回避策が違う**。実測で分けると:

| 経路 | 呼び方 | fetch ラッパで直せるか |
|---|---|---|
| `handle-resolver` の `well-known-handler-resolver.js` | 注入した fetch を `(url, init)` で直接呼ぶ | **直せる**（ラッパが `init.redirect` を書き換えてから `Request` を作ればよい） |
| `did-resolver` の `methods/plc.js`・`methods/web.js` | `bindFetch()` 経由。Request は上流で組まれる | **直せない** |
| `handle-resolver` の `xrpc-handle-resolver.js` | 同上 | 直せない（**DoH を使うので通らない**） |
| `oauth-client.js` の静的 `fetchMetadata` | 同上 | 直せない（**自分の metadata は自分で書くので呼ばない**） |

**必須の経路である `plc.js` が直せない**ので、追加の手当てが要る。probe で2案とも実機で通した。

- **案A: 自前の `didResolver` を差し込む**（`OAuthClient` の `didResolver` オプション）。
  `did:plc` は `https://plc.directory/<did>`、`did:web` は `/.well-known/did.json` を
  `redirect: 'manual'` で取り、3xx は自分で例外にする。ライブラリの
  `DidPlcMethod` / `DidWebMethod` を通らなくなるので `bindFetch` の問題が消える。**約40行。**
- **案B: `globalThis.Request` を Proxy で差し替える**（`redirect: 'error'` を `'manual'` に読み替え、
  その Request を `WeakSet` に覚えておいてラッパ側で3xx を例外にする）。ライブラリを無改造で使える。

**案Aを採る。** 案Bは Worker のアイソレート全体のグローバルを書き換えるため、
Bluesky と無関係な既存ルートまで影響範囲に入る。副作用の説明コストが実装量の差に見合わない。

案Aで通した実測（`bsky.app`。`kojira.io` でも同じ順序で成功、所要 2.4 秒）:

```
GET  https://cloudflare-dns.com/dns-query?type=TXT&name=_atproto.bsky.app   200
GET  https://bsky.app/.well-known/atproto-did                              (DNS が先に解決したので中断)
GET  https://plc.directory/did%3Aplc%3Az72i7hdynmk6r22z27h6tvur            200
GET  https://puffball.us-east.host.bsky.network/.well-known/oauth-protected-resource  200
GET  https://bsky.social/.well-known/oauth-authorization-server            200
POST https://bsky.social/oauth/par                                         400  (DPoP-Nonce 付き)
POST https://bsky.social/oauth/par                                         201
→ https://bsky.social/oauth/authorize?client_id=...&request_uri=urn:ietf:params:oauth:request_uri:req-...
```

**認可 URL に載るのは `client_id` と `request_uri` だけ**で、設計7.3 の前提（`state` は URL に出ない）は
実測どおりだった。localhost 例外（`client_id` はポート無しの `http://localhost?...`、
`redirect_uri` は `http://127.0.0.1:4380/callback`）も PAR に受理された。

**認可画面は通していない。** 実際のログイン（`callback()` / トークン交換 / `iss` 照合）は
staging で確認する（設計17章 PR4）。

#### S3 の詳細

`wrangler deploy --dry-run --outdir` の実測。

| 対象 | 生 | gzip |
|---|---|---|
| いまの Worker | 996.16 KiB | 231.87 KiB |
| いまの Worker + Bluesky 一式 | 1438.78 KiB | **308.60 KiB** |
| 差分 | +442.62 KiB | **+76.73 KiB** |

Workers の上限は圧縮後 3 MiB（無料プランは 1 MiB）。**どちらに対しても余裕がある。**

起動 CPU の代替計測として、workerd 内でモジュール評価（トップレベルの動的 import）を測った:
`@atproto/oauth-client` が **6 ms**、`@atproto/jwk-webcrypto` と `@atproto-labs/handle-resolver` が
合わせて **1 ms**（ローカル workerd）。上限 400 ms に対して十分だが、
**実機の startup CPU は実デプロイ時に Cloudflare が報告する値で確認する**（staging で見る）。

#### S4 の詳細

`WebcryptoKey.generate(['ES256'], undefined, { extractable: true })` →
`key.privateJwk` → `JoseKey.fromJWK()` で往復し、`kid` の一致・公開 JWK の一致・
同じヘッダ/ペイロードの JWT を作れることを確認した。**`extractable: true` を渡さないと
`privateJwk` が取れない**ので、`runtimeImplementation.createKey` でこれを必ず指定する。

#### S5 の詳細

PAR の1回目は必ず 400 `use_dpop_nonce`（`DPoP-Nonce` ヘッダ付き）で返り、
ライブラリが nonce を貼り直して2回目で 201。**1往復で決まる。**

ただし nonce のキャッシュ（`dpopNonceCache`）は `OAuthClient` インスタンスごとなので、
**リクエストごとにクライアントを作ると毎回この余計な400が1回入る**（実測で認可開始が約2.1〜2.4秒）。
実装では `dpopNonceCache` をモジュールスコープに置いて同一アイソレート内で使い回す。
それでも Workers はアイソレートが短命なので、**「毎回1往復増える」前提で見積もる**。

#### 設計へ反映した変更

- **8章を全面的に書き直した**（fetch ラッパだけでは足りない、自前 `didResolver` が要る）。
- 5章に `auth/bluesky/didResolver.ts` を追加した。
- 14章のテスト6に自前 `didResolver` の検証を追加した。

---

## 5. モジュールの分割

**`routes/auth.ts` は太らせない。本設計では最終的に短くなる。**

### 新規

| ファイル | 役割 | 目安 |
|---|---|---|
| `apps/server/src/auth/bluesky/client.ts` | `OAuthClient` の組み立て（clientMetadata 生成・runtime 実装・store 配線・handleResolver）。**環境ごとの `client_id` / `redirect_uri` の分岐はここだけ** | 120行 |
| `apps/server/src/auth/bluesky/fetch.ts` | `redirect: 'error'` 回避の fetch ラッパ。**上流バグの回避策であることと消せる条件を明記**（8.1） | 50行 |
| `apps/server/src/auth/bluesky/didResolver.ts` | 自前の DID 解決（`did:plc` / `did:web`）。`bindFetch` を通る経路を外すための回避策（8.2）。**同じ「消せる条件」を明記** | 60行 |
| `apps/server/src/auth/bluesky/stateStore.ts` | D1 バックの `StateStore`。DPoP 鍵の JWK 変換・TTL・掃除。トークン用の store は**使い捨ての Map** | 110行 |
| `apps/server/src/auth/bluesky/profile.ts` | 公開 AppView から表示名・アイコンを取得（認証不要） | 50行 |
| `apps/server/src/auth/bluesky/index.ts` | 外向きの2関数 `startLogin(handle, appState)` / `finishLogin(params)` とエラーコードの正規化 | 120行 |
| `apps/server/src/routes/authBluesky.ts` | Hono サブアプリ。`GET /client-metadata.json` / `GET /login` / `GET /callback` の**配線だけ**。`auth/bluesky/index.js` は**動的 import**（下記） | 190行 |
| `apps/server/src/db/repositories/blueskyAuthState.ts` | state 行の CRUD と掃除（生 SQL はここだけ） | 60行 |
| `apps/server/migrations/00XX_bluesky_oauth_state.sql` | state テーブル | — |

**`auth/bluesky/index.ts` はルートから動的 import で読む**（設計から変えた点）。
`@atproto/oauth-client` は core-js を含む大きな依存を引くので、静的に繋ぐと
**Bluesky を使わないリクエストでも評価され、Worker の起動 CPU を無駄に使う**
（gzip 後 +76.7 KiB、モジュール評価 6ms — 4.2 の S1・S3）。
そのぶん Bluesky の入口をこのファイル1つに揃え、境界を増やさないこと。
型だけの import は消えるので静的でよい。

### 既存への変更（小さいものだけ）

| ファイル | 変更 |
|---|---|
| `routes/auth.ts` | サブアプリのマウント1行（`/:provider/*` より**前**に登録する。Hono は登録順に照合するため）。`DELETE /identities/:provider` の判定に `bluesky` を追加 |
| `auth/accountLink.ts`（**新規・純粋な移動**） | `takeoverEmptyAccount()` と `isPendingDeletion()` を `routes/auth.ts` から移す。**振る舞いは変えない** |
| `worker.ts` | staging ゲートの素の HTML にハンドル入力欄を足す（13章） |
| `apps/web/src/lib/providers.ts` | `bluesky` のラベル・色を追加 |
| `apps/web/src/pages/LoginPage.tsx` | ハンドル入力欄とボタン |
| `apps/web/src/pages/AccountPage.tsx` | 連携行の追加とエラー文言 |
| `lib/avatarStore.ts` | `syncAvatarInBackground()` を `routes/auth.ts` から**移す**（振る舞いは変えない）。Bluesky が2つ目の呼び手になるため（5.2） |

### 5.1 引き取り規則を1か所に保つ

「ログイン中なら連携、別アカウントに連携済みなら空アカウントのみ引き取り、
未ログインなら既存ログイン or 新規作成、猶予期間中なら復帰画面へ」——
この規則はいま `routes/auth.ts` の OAuth コールバックと Nostr ログインに**2回書かれている**。
Bluesky で3回目を書くのは避ける。

`auth/accountLink.ts` に次を置き、**Bluesky と既存 OAuth の両方から呼ぶ**。

```ts
// 疑似シグネチャ
finishIdentityLogin(c, {
  provider: string,
  providerUserId: string,     // bluesky なら DID
  profile: { username, globalName, avatarUrl, email },
  onLinked?: (userId) => Promise<void>,  // discord の setDiscordId 用の逃がし口
}): Promise<
  | { kind: "linked" }
  | { kind: "logged_in"; pendingDeletion: boolean }
  | { kind: "link_error"; code: "already_linked" | "account_in_use" | "account_deleted" }
>
```

これは**振る舞いを変えない抽出**であり、既存の引き取り・退会猶予のテストが回帰の網になる。
副産物として `routes/auth.ts` は 100 行ほど短くなる。

### 5.2 アイコンは自前で保管し直す（既存に揃える）

既存の OAuth はログインのたびに連携先のアイコンを取り込んで R2 に保管し、
`avatar_url` を自ドメインの URL へ差し替えている (#312)。連携先で
アイコンを変えると旧 URL が 404 になるためで、Bluesky の CDN も同じ性質を持つ。
**外部 URL をそのまま保存すると、同じ機能の中で扱いが割れる。**

その取り込みを逃がす関数 `syncAvatarInBackground()` は `routes/auth.ts` の
私有関数だったので、**`lib/avatarStore.ts` へ移して両方から呼ぶ**（複製しない）。
移動は純粋な移動で、既存のアイコンのテストが回帰の網になる。

- **ログイン時**は既存 OAuth と同じく毎回取り込む（退会申請中は取りに行かない）。
- **連携時**は `avatar_url` が空だったときだけ取り込む。既に設定済みの表示を
  勝手に書き換えない（11章の「空のときだけ埋める」と同じ規則）。

---

## 6. 公開エンドポイントと環境差

### 6.1 client-metadata.json

`GET /api/auth/bluesky/client-metadata.json` を Worker が動的に返す。

```jsonc
{
  "client_id":    "<APP_BASE_URL>/api/auth/bluesky/client-metadata.json",
  "client_name":  "events lab",
  "client_uri":   "<APP_BASE_URL>",
  "redirect_uris": ["<APP_BASE_URL>/api/auth/bluesky/callback"],
  "scope": "atproto",
  "grant_types": ["authorization_code"],   // refresh_token は要求しない（トークンを持たないため）
  "response_types": ["code"],
  "application_type": "web",
  "dpop_bound_access_tokens": true,
  "token_endpoint_auth_method": "none"
}
```

決めごと:

- **`client_id` は自分自身の URL と完全一致していなければならない。** `APP_BASE_URL` から組み立てる。
- **`/api/auth/` 配下に置く。** staging ゲートは
  `path.startsWith("/api/auth/")` を無条件で通すので、**許可リストの変更が要らない**。
  認可サーバーは未認証でこれを取りに来るため、ここを外すと staging でだけ動かなくなる。
- `Content-Type: application/json` と **200**（3xx やその他の 2xx は不可）。
- `Cache-Control: public, max-age=300` を付ける。認可サーバーはキャッシュしてよいが、
  **最小・最大 TTL は仕様上定まっていない**。public client では鍵を載せないので、
  キャッシュが古くても実害が出ない（16章で confidential へ移るときだけ問題になる）。
- `refresh_token` を宣言しない。トークンを保存しない設計を metadata の上でも表明しておく。

環境ごとの値:

| 環境 | `APP_BASE_URL` | `client_id` |
|---|---|---|
| 本番 | 本番のホスト | そのホストの client-metadata.json |
| staging | staging のホスト | 同上 |
| dev | `http://localhost:4280` | **localhost 例外**（9章） |

`wrangler.toml` の追加は無い（`APP_BASE_URL` は既にある）。**シークレットの追加も無い。**

### 6.2 jwks.json は作らない

public client なので公開鍵が存在しない。将来 confidential へ移るときに追加する（16章）。

---

## 7. state の保存先と TTL、掃除

認可開始からコールバックまで持ち越す必要があるもの:

- **DPoP 秘密鍵**（この試行専用。コールバックのトークン交換で同じ鍵の proof が要る）
- **PKCE の verifier**
- **`iss`**（どの認可サーバーへ行ったか。コールバックの `iss` と照合する）
- クライアント認証方式（`none`）
- アプリ側の付随情報（ログイン後の戻り先）

既存の使い捨て nonce の仕組みは「使ったかどうか」しか持てないので流用できない。
cookie に全部入れる案もあるが、**DPoP 秘密鍵をブラウザに預けることになる**うえ、
掃除の記録も残らない。**D1 に持つ。**

### 7.1 テーブル

```sql
-- Bluesky ログイン (#381) の認可開始〜コールバック間の持ち越し。
--
-- AT Protocol の OAuth は DPoP が必須で、ログイン試行ごとに ES256 鍵を作る。
-- その秘密鍵と PKCE の verifier、どの認可サーバーへ行ったか (iss) を
-- コールバックまで保持する必要がある。既存の使い捨て nonce の仕組み
-- (nostr_challenge_used) は「使ったかどうか」しか持てないため流用できない。
--
-- cookie に入れない理由: DPoP の秘密鍵をブラウザに預けることになるため。
-- ブラウザとの紐付け (CSRF 対策) は別途 cookie で行う (routes/authBluesky.ts)。
--
-- data は JSON。DPoP 鍵は JWK にして入れる (Key オブジェクトはそのままでは保存できない)。
-- 秘密鍵が入るので、行は使用時に必ず削除し、TTL を過ぎたものは掃除する。
CREATE TABLE bluesky_oauth_state (
  state TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- 掃除 (created_at < ?) が全表走査にならないように
CREATE INDEX idx_bluesky_oauth_state_created ON bluesky_oauth_state(created_at);
```

### 7.2 TTL と掃除

- **TTL は10分。** 既存 OAuth の state cookie および Nostr チャレンジと揃える。
- **読むときに期限を見る。** `created_at < now - TTL` の行は「無い」ものとして扱う。
- **掃除は書き込みのついで。** 認可開始のたびに
  `DELETE FROM bluesky_oauth_state WHERE created_at < ?`（`now - TTL*2 = 20分`）を1文流す。
  `auth/nostr.ts` の掃除と同じ流儀。**cron は増やさない。**
- **使ったら消す。** ライブラリは検証の前に `del(state)` を呼ぶ（リプレイ防止）。
  この順序に依存しているので、`del` を握りつぶさない。
- **認可開始が失敗しても消す。** 行は PAR の**前**に書かれるので、PAR で落ちると
  秘密鍵を含む行が残る。`startLogin` は書かれた `state` を覚えておき、失敗したら消す。
- **コールバックで弾いたときも消す**（期限切れ・cookie の tag 不一致）。
- **それでも残る経路がある。** コールバックに来ないまま放置された行と、
  `stateStore.get` に到達する前に落ちた行は掃除まで残る＝**最大20分**。
  マイグレーションのコメントもこの4経路で書いてある（実装と食い違わせない）。

### 7.3 ブラウザとの紐付け

ライブラリが生成する `state` は PAR を使うと**認可 URL に現れない**（URL に載るのは
`client_id` と `request_uri` だけ）ので、開始時点では cookie に書けない。代わりに:

- 認可開始時に 16 バイトの乱数（`tag`）を作り、`authorize()` の `state` オプション
  （＝ライブラリの `appState`）に `tag` と戻り先を入れて渡す。
- 同じ `tag` を cookie（httpOnly / SameSite=Lax / `secure` は本番のみ / 10分）に書く。
- コールバックでは、**トークン交換より先に** state 行を覗いて（行は消さない）
  `appState` の `tag` と cookie を突き合わせる。一致しなければ行を消して 400。
  既存の state cookie と同じ役割。

**照合を先にするのは実装で設計から変えた点**（当初は `callback()` の後に置いていた）。
後回しにすると、CSRF や期限切れのために**外部と1往復してしまう**うえ、
ライブラリの `get` は「期限切れ」と「そもそも無い」を同じ `undefined` に潰すので
応答を分けられない。覗くだけの `peekState` を state ストア側に置き、
TTL の知識をルートへ漏らさないようにしている。

---

## 8. `redirect: 'error'` の回避策（4.2 の実測で確定）

`@atproto/oauth-client` とその依存は、リダイレクトを拒否するために
`redirect: 'error'` を使う。**workerd はこの値を `new Request()` の構築時点で拒否して
TypeError を投げる**（`fetch()` を呼ぶ前に落ちる）。

```
TypeError: Invalid redirect value, must be one of "follow" or "manual"
("error" won't be implemented since it does not make sense at the edge;
 use "manual" and check the response status code).
```

**したがって注入した fetch のラッパだけでは足りない。** `@atproto-labs/fetch` の
`bindFetch()` は、注入した fetch を呼ぶ**前に** `asRequest()` で Request を組むためである。
回避策は2枚に分かれる。

### 8.1 `auth/bluesky/fetch.ts` — fetch ラッパ

注入した fetch が `(url, init)` の形で直接呼ばれる経路だけを担当する。

- **何をしているか**: `init.redirect === 'error'` を `'manual'` に読み替えてから `Request` を組む。
  **そのうえで、応答が 3xx なら自分で例外にする**。ここを省くと
  「リダイレクトを拒否する」という元の安全性が黙って失われる。
- **効く経路**: `@atproto-labs/handle-resolver` の
  `internal-resolvers/well-known-handler-resolver.js`（ハンドルの `.well-known` 解決）。
- **効かない経路**: `bindFetch()` を通るもの。下記 8.2 で外す。

### 8.2 `auth/bluesky/didResolver.ts` — 自前の DID 解決

`OAuthClient` の `didResolver` オプションに自前の実装を渡し、
`bindFetch()` を使う `@atproto-labs/did-resolver` の `methods/plc.js` /
`methods/web.js` を**通らないようにする**。これが**必須の経路**（DID 解決に失敗すると即ログイン不能）。

- `did:plc:` → `https://plc.directory/<did>`、`did:web:` → `https://<host>/.well-known/did.json`
- `redirect: 'manual'` で取り、**3xx は自分で例外にする**（元の意図を保つ）
- `@atproto/did` の `didDocumentValidator` で DID ドキュメントを検証し、
  **`doc.id` が要求した DID と一致すること**を確かめる。ライブラリ側の検証を落とさないため
- 目安40行。**グローバル（`globalThis.Request`）は書き換えない**——
  アイソレート全体に影響し、Bluesky と無関係な既存ルートまで巻き込むため（4.2 の案B、却下）

### 8.3 通らない経路（手当て不要）

- `@atproto-labs/handle-resolver` `xrpc-handle-resolver.js` — **DoH を使うので通らない**
- `@atproto/oauth-client` `oauth-client.js` の静的 `fetchMetadata` —
  **自分の metadata は自分で書くので呼ばない**

### 8.4 消せる条件

workerd が `redirect: 'error'` を受け付けるようになったら、8.1 と 8.2 の両方を削除して
素の `fetch` とライブラリ既定の DID 解決に戻す。判定は
`new Request(url, { redirect: 'error' })` が投げないことを `wrangler dev` で確かめるだけでよい。
**この判定を 8.1 のコメントに書いておく。**

---

## 9. dev の扱い

**localhost 例外を使う。**「dev では諦める」は採らない。この機能は外部の認可画面を
何度も往復して初めて詰められるため、開発で回せないと staging での試行錯誤に化ける。

- `client_id` は `http://localhost?redirect_uri=<encoded>&scope=atproto`
  （**ポート番号を付けてはいけない。パスは空**）
- `redirect_uri` は **`http://127.0.0.1:4280/api/auth/bluesky/callback`**。
  ループバックには `127.0.0.1` を使うのが RFC 8252 の要求で、`client_id` 側が
  `localhost` なのと食い違って見えるがこれで正しい（aozoraquest に同じ注記がある）。
- **ブラウザも `http://127.0.0.1:4280` で開く**こと。`localhost` で開くと
  認可後に戻ったとき cookie のオリジンが違ってセッションが繋がらない。
  `.dev.vars.example` と README にこの1行を書く。
- localhost 例外の client は認可サーバー側で public として合成される。
  本番も public なので**挙動差は小さい**。

---

## 10. ログインの流れ

```
[ログイン画面] ハンドル入力（例: yourname.bsky.social）
   │  GET /api/auth/bluesky/login?handle=...   ← 素のフォーム GET。トップレベル遷移
   ▼
[Worker] 1. ハンドルの形を検証（先頭 @ を落とす・小文字化・長さと文字種）
         2. client.authorize(handle, { state: {tag,next} })
              ├ ハンドル → DID（DoH の TXT、無ければ .well-known）
              ├ DID → DID ドキュメント → PDS
              ├ PDS の /.well-known/oauth-protected-resource → 認可サーバー
              ├ 認可サーバーの metadata
              ├ DPoP 鍵を生成、PKCE を生成
              ├ state 行を D1 に書く（鍵は JWK にして格納）
              └ PAR（DPoP。nonce を求められたら貼り直して1回リトライ）
         3. cookie に tag を書く（10分）
         4. 302 → 認可サーバーの authorize?client_id=...&request_uri=...
   ▼
[認可サーバー] 利用者がログイン・許可
   ▼
[Worker] GET /api/auth/bluesky/callback?code=...&state=...&iss=...
         5. state 行を**覗く**（消さない）。無ければ 400
         6. appState の tag と cookie を突き合わせる
              ├ 期限切れ      → 行を消して /login?bluesky_error=expired
              └ tag 不一致    → 行を消して 400
         7. client.callback(params)   ← ここで初めて外部と話す
              ├ state 行を引いて即削除（リプレイ防止）
              ├ iss を照合
              ├ トークン交換（PKCE verifier + DPoP、client 認証は none）
              └ sub(DID) を再解決 → PDS → 認可サーバーの対応と issuer 一致を確認
         8. トークンを捨てる（失敗は無視）
         9. 公開 API で表示名・アイコンを取得（認証不要）
        10. finishIdentityLogin(provider="bluesky", providerUserId=DID, ...)
        11. アイコンを自前保管に差し替える（5.2）
        12. issueSession → 302 /me（猶予期間中なら /restore）
```

補足:

- **`sub` の DID をそのまま `identity.provider_user_id` に入れる。**
  ハンドルは表示にしか使わない（ハンドルは変わる。DID は変わらない）。
- 新規作成時の我々のハンドルは `deriveHandle()` に通す。
  Bluesky のハンドルは `.bsky.social` が付いて長いので、末尾を落としてから渡す。
  衝突は既存の `availableUsername()` が連番で解消する。
- `discord_id` は `createFromProfile` が合成値を入れる（既存の仕組みどおり。
  `ADMIN_DISCORD_IDS` に一致しない＝管理者にならない）。
- **8 のトークン破棄は「やってみるだけ」**。認可サーバーが revoke に失敗しても
  ログインは成功として扱う（我々の手元には何も残っていない）。
- **cookie の照合（6）をトークン交換（7）より先に置くのは設計から変えた点。**
  理由は 7.3 に書いた（CSRF や期限切れのために外部と1往復しない）。
- **戻り先（`next`）は `@eventer/shared` の `safeRedirectPath` に通す。**
  画面側と同じ関数（規則を2か所に分けない）。`//evil` や `/\evil` を弾き、
  同一オリジンに解決できたときだけパスを**組み直して**返す。改行入りの値が
  Location に素通りすると 302 の構築で落ち、**セッションは発行済みなのに
  リダイレクトが返らない**（＝ログインしたのに未ログイン）ため、ここは形の
  検査ではなく組み直しでなければならない。
- **2 には10秒のタイムアウトを付ける**（13.4）。

---

## 11. 連携（あとから足す）の流れ

分岐は**既存 OAuth と同じ「セッションがあるか」だけ**。専用のルートは作らない。

- アカウント設定 → Bluesky の行 →「連携する」→ ハンドルを入力 →
  `GET /api/auth/bluesky/login?handle=...` へトップレベル遷移（ログインと同じ URL）。
- コールバックで `currentUser(c)` が居れば連携、居なければログイン。
- 連携時の結果は `finishIdentityLogin` が返す:
  - 未連携 → `identity` に行を足して `/account` へ
  - 同じユーザーに連携済み → 何もせず `/account` へ
  - **別アカウントに連携済み** → `takeoverEmptyAccount()`。
    「唯一の連携」かつ「利用実績なし」かつ「退会申請中でない」ときだけ引き取る。
    それ以外は `/account?link_error=<code>` へ。
- 表示名・アイコンは**空のときだけ埋める**。Nostr のプロフィール反映と同じ扱いで、
  既に設定済みの利用者の表示を勝手に書き換えない。
- 解除は既存の `DELETE /api/auth/identities/:provider` に `bluesky` を通すだけ。
  最後の1つは外せない規則もそのまま。

---

## 12. エラーの扱い

**引き取りの失敗は既存の `link_error` をそのまま使う。**
（`already_linked` / `account_in_use` / `account_deleted`）

**フローの失敗は別のクエリ（`bluesky_error`）にする。**
理由: `linkErrorMessage()` は未知のコードを `already_linked` の文言にフォールバックするため、
新しいコードを `link_error` に混ぜると**誤った説明が出る**。

| 事象 | コード | 文言（UI。内部用語を出さない） |
|---|---|---|
| ハンドルが解決できない | `handle_not_found` | 「そのハンドルのアカウントが見つかりませんでした。入力を確認してください（例: yourname.bsky.social）」 |
| 接続先が落ちている・応答しない | `unavailable` | 「Bluesky 側に接続できませんでした。時間をおいて試してください」 |
| 認可を断られた | `denied` | 画面に戻すだけ。**エラー扱いにしない**（利用者が自分で取り消した） |
| state が期限切れ・見つからない | `expired` | 「時間が経ちすぎました。もう一度やり直してください」 |
| その他（交換失敗・検証失敗） | `failed` | 「ログインできませんでした。時間をおいて試してください」 |

**`state` の異常は画面に出さず 400 にする**（設計から変えた点）。当初はすべて
`bluesky_error` で画面へ返す形だったが、次の2つは性質が違う。

| 事象 | 応答 | 理由 |
|---|---|---|
| state 行が無い / 使用済み（リプレイ）/ cookie の tag 不一致 | **400**（`invalid_oauth_state`） | 利用者の操作では起こらない。攻撃か壊れた戻りなので、画面に説明を出さない（既存 OAuth の `invalid_oauth_state` と同じ扱い） |
| state が**期限切れ**（10分） | `?bluesky_error=expired` でリダイレクト | 認可画面で手間取れば普通に起きる。やり直しの導線が要る |

- 遷移先: 未ログインなら `/login?bluesky_error=...`、ログイン中なら `/account?bluesky_error=...`。
- **サーバーのログには原因を残す**（段階名と例外）。UI には出さない。
- 「DID」「PDS」といった内部用語は**画面に出さない**。「Bluesky」「ハンドル」は出してよい。

---

## 13. UI の変更

### 13.1 ログイン画面

- 既存のボタン群の下に **ハンドル入力欄＋「Bluesky でログイン」ボタン**。
- **素の `<form method="get" action="/api/auth/bluesky/login">`** にする。
  fetch ではなくトップレベル遷移でないと認可サーバーへ飛べない。
- 入力補助: 前後の空白を落とす、先頭の `@` を落とす、小文字化。空なら送信不可。
- プレースホルダは `yourname.bsky.social`。
- 「Bluesky が使えるかどうか」の問い合わせは不要（シークレットが無いので常に有効）。
  Nostr と同じく画面側に固定で並べる。

### 13.2 アカウント設定

- 連携の一覧に `bluesky` を追加。
- 未連携のときのボタンは、押すと**小さな入力欄（またはダイアログ）**を出してハンドルを聞き、
  同じ URL へ遷移する。
- `?bluesky_error=` を読んで既存のモーダルと同じ見せ方で表示し、
  閉じたらクエリを消す（既存の作法と揃える）。

### 13.3 staging ゲート

- ボタン列の下に **入力欄1つと送信ボタン1つの素の form** を足す。
  `<form method="get">` なので **JavaScript は増やさない**。
- 既存の文言に合わせた表記にする。

### 13.4 `GET /login` だけコスト特性が違う

**この入口は、既存の `/:provider/login` と性質が違う。** 既存はリダイレクトを
組み立てて返すだけ（外部通信ゼロ・DB 書き込みゼロ）だが、こちらは**未認証のまま**

- 入力されたハンドル由来のホストへ**外部 fetch が3〜5回**出ていき、
- 解決に成功すると **D1 に state 行が1行書かれる**（PAR の前）。

つまり `?handle=<攻撃者のドメイン>` を連打すると、Worker を踏み台にして
第三者のホストへ接続させたり、書き込みを増やしたりできる。手当ては次のとおり。

- **タイムアウトを付ける**（`BLUESKY_RESOLVE_TIMEOUT_MS` = 10秒）。ライブラリは
  この `signal` を識別子の解決にだけ渡すが、**攻撃者が指定したホストへ出ていくのは
  その段だけ**なので、抑えたい経路は覆える。実測の happy path は 2.1〜2.4 秒。
- **失敗したら state 行を消す**（7.2）。
- **回数制限は入れていない。** このリポジトリには未認証の入口に効く回数制限の
  仕組みが無い（`shared/abuse.ts` はログイン後の行動を運営が目視する仕組みで、
  `takeOgFetchSlot` などは1リクエスト内の予算）。ここだけのために新しい仕組みを
  作ると、**同じ用途の仕組みが2つになる**。入れるなら Cloudflare 側の
  Rate Limiting Rules（`/api/auth/bluesky/login` に IP 単位）か、
  全体に効く共通の仕組みとして別途設計する。**判断は運用側に委ねる。**

---

## 14. テストで確かめること

**外部通信はしない。**

| # | 対象 | 確かめること |
|---|---|---|
| 1 | `GET /client-metadata.json` | 200 / `application/json` / `client_id` が自分の URL と一致 / `redirect_uris` が `APP_BASE_URL` 由来 / `token_endpoint_auth_method` が `none` / `dpop_bound_access_tokens` が `true` / `scope` が `atproto` |
| 2 | metadata の組み立て（純関数） | https の base では通常の client_id、`localhost` の base では **localhost 例外の形**（ポート無し・`redirect_uri` は 127.0.0.1）になる |
| 3 | `GET /login` の入力検証 | ハンドル未指定・空・長すぎ・不正文字は **外部へ出る前に 400**。`@` 付き・大文字・前後空白は正規化される |
| 4 | `GET /callback` | `state` 無しで 400 / cookie の tag 不一致で 400 / 同じ state の2回目は 400（1回目で行が消える） |
| 5 | state ストア（ユニット） | 保存→取得で DPoP 鍵が JWK 経由で往復する / TTL 超過の行は取得できない / 掃除の SQL が古い行だけ消す |
| 6 | fetch ラッパ（ユニット） | `redirect: 'error'` が `'manual'` に置き換わる / **3xx 応答で例外になる**（黙って追従しない） / `'follow'` はそのまま |
| 6b | 自前 `didResolver`（ユニット） | `did:plc` / `did:web` の URL の組み立て / **3xx で例外**（追従しない）/ `doc.id` が要求した DID と違えば例外 / 不正な DID ドキュメントで例外 / 未対応の DID メソッドで例外 |
| 7 | 引き取り規則（ユニット） | `provider="bluesky"` で既存3ケースが既存と同じ結果になる |
| 8 | 回帰 | 既存の認証・引き取り・退会猶予のテストが無変更で通る（`accountLink` 抽出の安全網） |
| 9 | 解除 | `DELETE /api/auth/identities/bluesky` が 404 にならない / 最後の1つは 409 |

**やらないテスト**: 認可サーバーとの実通信、DPoP nonce の往復、PAR。
これらはスパイク（4章）と staging での手動確認で見る。モックを積み上げても
「上流ライブラリが workerd で動くか」という肝心の問いには答えられない。

---

## 15. やらないこと

- **投稿・書き込み一切**（イベント告知の自動投稿を含む）。したがってトークンを保存しない。
- **リフレッシュトークンの管理**、セッションの延長、失効監視。
- **粒度の細かい scope**（策定中）。`atproto` 単独で行く。`transition:*` は使わない。
- **アプリパスワード**。廃止予定なので最初から採らない。
- **Bluesky のハンドルを我々のハンドルにする**こと。初期値の材料にするだけ。
  ハンドル変更の追従もしない（識別子は DID なので追従しなくても壊れない）。
- **フォロー関係やフィードの取り込み。**
- **confidential client 化**（16章の移行手順だけ残す）。
- **DID の移行への特別対応。** DID は移行しても変わらないので何もしなくてよい。

---

## 16. 将来 confidential client へ移るときの手順

投稿機能を足すとトークンの保持と更新が要り、そのとき public client の寿命では
足りなくなる。そのときだけ次を行う。**いま作らない。**

1. ES256（P-256）の鍵ペアを作り、**秘密鍵の JWK をシークレット**に入れる。
   `kid` は日付を含む固定文字列にする。
2. `GET /api/auth/bluesky/jwks.json` を足し、**公開鍵だけ**を返す。
   client metadata に `jwks_uri` と `token_endpoint_auth_method: "private_key_jwt"`、
   `token_endpoint_auth_signing_alg: "ES256"` を足す（`jwks` と `jwks_uri` は**両方書かない**）。
3. **ローテーションは「新旧を並べる」方式。**
   - 新しい鍵を `jwks.json` に**追加**する（署名にはまだ古い鍵を使う）。
   - **キャッシュが入れ替わるのを待つ。認可サーバー側のキャッシュ TTL は仕様上不定**なので、
     短く見積もらない。**24時間以上、できれば1週間**空ける。
   - 署名を新しい鍵に切り替える（`kid` を変える）。
   - さらに同じだけ待ってから、古い鍵を `jwks.json` から外し、シークレットを消す。
   - 手順の各段でログイン成功率を見る。失敗が出たら**古い鍵の削除だけを巻き戻す**。
4. 移行の互換性: **保存済みセッションが無いので、切り替えで壊れる利用者はいない。**
   （confidential 化して以降に保存を始めたら、この性質は失われる）

---

## 17. 実装の順番

| PR | 内容 | 検証 |
|---|---|---|
| 0 | **スパイク**（4章）。probe ルートで S1〜S5。結果を本書に追記 | **完了（4.2）**。`wrangler dev` で実在ハンドル2件の PAR まで通した |
| 1 | `accountLink.ts` の抽出（**振る舞い変更なし**）。`routes/auth.ts` が短くなる | 既存テストが無変更で通ること |
| 2 | マイグレーション + state リポジトリ + state ストア + fetch ラッパ（**ルートはまだ生やさない**） | ユニット（5・6） |
| 3 | `auth/bluesky/*` 本体 + `routes/authBluesky.ts` + client-metadata | テスト 1〜4・9 |
| 4 | UI（ログイン画面・アカウント設定・staging ゲート） | 手動。staging で本番相当の URL でログイン・連携・解除・引き取り |

PR1 と PR2 は Bluesky の実装が失敗しても単独で意味がある（前者は重複の解消、後者は未使用のまま無害）。
PR0 は通ったので **PR3 はライブラリ方式で書く**（Plan B は採らない）。
PR2 の範囲に **8.2 の自前 `didResolver`** が加わる（fetch ラッパと同じ「回避策」の枠）。

---

## 18. 出典

仕様:

- AT Protocol OAuth 仕様 `https://atproto.com/specs/oauth`
- クライアント実装ガイド `https://docs.bsky.app/docs/advanced-guides/oauth-client`

ライブラリ（`@atproto/oauth-client`）:

- 版は **0.8.2**（4.2 で実測。0.8.3 は `minimumReleaseAge` により未採用）
- `authorize()` / `callback()`（PAR・state・iss 照合・`sub` 再解決）
- `InternalStateData` に `iss` / `dpopKey` / `verifier` / `appState`
- `token_endpoint_auth_method: 'none'` を正式にサポート
- `redirect: 'error'` の該当箇所と、経路ごとの回避策は 8 章
- `didResolver` オプションで DID 解決を差し替えられる（8.2 が依存している契約）

先行実装（`github.com/kojira/aozoraquest`。**コードは持ち込まない。参照のみ**）:

- `apps/web/src/lib/oauth.ts` — 本番で動いている public client の設定、localhost 例外の注意
- `apps/web/vite.config.ts` — client metadata の中身
- `apps/edge/src/oauth-probe.ts` — `@atproto/oauth-client-node` が Workers で落ちる記録
- `docs/15-user-quest.md` — サーバー側 confidential client の構想（**未実装**）
- `apps/web/src/lib/follows-resonance.ts` — DPoP と CORS の実測、公開 AppView を使う判断
