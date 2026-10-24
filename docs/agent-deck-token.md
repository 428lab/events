# AIエージェントにスライドを書いてもらう一時トークン

- オーナー決定（kojira 2026-10-23）: 「スライドを作って」と頼むときに、仕様のURLとトークンをAIに渡す。AIがそれを読んで、利用者のスライドを書く。画像もアップロードできる。
- 既存の「LLMで作る／取り込む」（[lab-llm-slides-import.md](lab-llm-slides-import.md)、#523）では、利用者がJSONを貼り付けていた。そのJSON仕様 v2 と検証器をそのまま使い、AIが直接書き込める入口を足す。
- #581 の AI 連携トークン（未マージの #583〜#586）とは別物で、依存もしない。

## 1. 利用者の流れ

1. `/decks/import`（ログイン中）の「AIに書いてもらう」で「トークンを発行して指示文を作る」を押す。
2. 指示文が出るのでコピーして、Claude Code など HTTP を送れる AI に渡し、作ってほしい内容を書き足す。

   ```
   events lab にスライドを作ってください。
   手順と仕様: https://events.kojira.io/deck-import/agent.md
   トークン: evd_…（YYYY/MM/DD HH:mm まで有効）
   作ってほしい内容:
   ```

3. AIは `agent.md` を読む。デッキを作り、画像を上げ、書き直して、閲覧URLと編集URLを返す。
4. 画面へ戻ると（フォーカス時、または「最新にする」で取り直す。定期取得はしない＝D-POLL-MIN）、「有効なトークン」に「AIがスライドを作りました: <タイトル>」と出る。「編集を開く」「表示を開く」で確かめる。「取り消す」でいつでも止められる。作られたスライドは残る。

保存はすぐに効く（オーナー決定）。既存の取り込みと同じく、保存した時点でURLを知る人はログインせずに閲覧できる。発行画面にもその旨を出す。ChatGPT の通常のチャットのように、自分でHTTPを送れない相手は対象外。

## 2. トークン

| 項目 | 決め |
| --- | --- |
| 形式 | `evd_` + 32バイトの乱数（base64url、43文字） |
| 保存 | SHA-256 の16進だけを保存し、平文は発行の応答で1回だけ返す |
| 期限 | 発行から60分 |
| できること | 発行者の名前でデッキを**1つ**作る。期限内ならそのデッキを書き直し、画像を上げる。それ以外はできない |
| 上限 | 書き込み100回・画像50枚／トークン。発行は直近24時間で20本／利用者 |
| 失効 | 期限切れ、利用者の取り消し、退会申請（申請時点で全部取り消す。復帰しても戻らない） |
| 承認 | 不要。ログインしていれば誰でも発行できる（できることが既存の手動取り込みと同じため） |

### 到達範囲

- Bearer を読むのは `/api/agent/*` のミドルウェア1か所だけ。`currentUser`（Cookie）は一切変えていない。なので `evd_` トークンは、ほかのAPIではただの未ログインとして扱われる。
- 逆に `/api/agent/*` は Cookie を見ない。Cookie だけで来たら 401 を返す。
- 発行・一覧・取り消しは Cookie 認証の `/api/decks/agent-tokens`。発行と取り消しは、JSON取り込みと同じく同一 Origin に限る。

## 3. 表（migration `0114_deck_agent_token.sql`）

```
deck_agent_token(id PK, owner_id → user ON DELETE CASCADE, token_hash UNIQUE,
                 deck_id UNIQUE NULL, write_count, image_count, last_write_id,
                 created_at, expires_at, revoked_at)
```

- `deck_id` は最初の書き込みで決まる。FK は付けない。利用者がデッキを消したら、次の書き込みが `410 deck_deleted` を返す。
- 1回目は、`UPDATE token SET deck_id …` と `INSERT deck … WHERE EXISTS(token.deck_id = ? AND last_write_id = ?)` を1つの batch で流す。同時に2本来ても、デッキは1つしかできない。
- 2回目以降は、カウンタの UPDATE が `last_write_id` に要求ごとのノンスを書く。デッキの UPDATE はそのノンスがあるときだけ当たる。こうして「回数上限を超えたのに書き込みだけ通る」をなくしている。
- 退会: 申請の batch で `revoked_at` を立てる。完全削除は `ON DELETE CASCADE` で行う。
- 統合: `mergeUsers` の simple に `["deck_agent_token","owner_id"]` を足す。結び付いたデッキと同じ勝ち側へ移す。
- user 参照列の総数を数えるテスト（`user-tables` / `merge-user-columns`）は 63 → 64 にした。

## 4. API

| メソッド・パス | 認証 | 内容 |
| --- | --- | --- |
| `POST /api/decks/agent-tokens` | Cookie＋同一Origin | 発行。`201 {token, specUrl, id, createdAt, expiresAt, writeCount, imageCount, deck}`。上限超えは `429 agent_token_daily_limit` |
| `GET /api/decks/agent-tokens` | Cookie | 有効なトークンの一覧（平文は含まない）。`deck` はタイトル・slug・URL付き |
| `DELETE /api/decks/agent-tokens/:id` | Cookie＋同一Origin | 取り消し。他人のトークンは 404 |
| `GET /api/agent/deck` | Bearer | `{expiresAt, writesLeft, imagesLeft, deck, deckDeleted}` |
| `PUT /api/agent/deck` | Bearer | v2 JSON。1回目は作成して `201`、以後は同じデッキを置き換えて `200`。応答は `{created, id, slug, editUrl, viewUrl}` |
| `POST /api/agent/deck/images` | Bearer | 生の画像（png/jpeg/webp/gif/avif、6MiB、先頭バイト検査）。デッキ作成後に限る。`201 {src, url}` |

- `PUT` は既存の `parseDeckImport` / `convertDeckImport` をそのまま通す。v2 だけを受け付ける。本文の上限は worker の1枚門で 1MiB（`/api/decks/import` と同じ扱いに足した）。
- 画像の `src` は既存の公開HTTPS URL に加えて、`/api/decks/<このトークンのデッキ>/images/<uuid>` を受け付ける（共有の検証器に `uploadedImageSrc` オプションを足した）。参照した画像は R2 に実在することも確かめる。無い・別デッキのパスなら `422 image_not_uploaded`。
- 画像は既存の `deck-images/{deckId}/{imageId}` に置き、配信は既存の公開 `GET /api/decks/:id/images/:imageId` を使う。退会時の R2 掃除も既存のプレフィックスで消える。
- エラーは `{error, message?, issues?}`。AI が自分で直せるように、`message` に次の手を書く。
- staging のログインゲートは、`/api/agent/*` と `agent.md`・v2 `spec.md`・`schema.json` だけを通す（AI は Cookie を持たないため）。
- 仕様書: `apps/web/public/deck-import/agent.md`（日本語＋英語の要約）。`.md` は既存の v1 spec と同じく、charset=utf-8 を付けて返す。

## 5. 入れないもの

- 読み取り（ほかのデッキ・利用者情報・イベント）、デッキの削除、公開状態の切り替え。
- 既存デッキの書き直し（トークンが作ったデッキだけ）。
- 差分更新。毎回 JSON 全体を送る。
- 汎用のトークン基盤、OAuth、#581 との統合。
- 画像の個別削除。上げすぎた画像は、デッキを消せば消える。
