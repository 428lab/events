# events lab: AIエージェントがスライドを書く手順

この文書は、events lab の利用者から「トークン（`evd_…`）」と一緒に渡されたAIエージェント向けです。トークンがあれば、その利用者の名前でスライドを**1つ**作り、期限内なら何度でも書き直せます。画像もアップロードできます。

- 起点URL: このファイルと同じオリジン（例: `https://events.kojira.io`）。以下では `$BASE` と書きます。
- 認証: すべてのリクエストに `Authorization: Bearer $TOKEN` を付けます。Cookie は使いません。
- トークンの有効期間は発行から60分。書き込みは100回、画像は50枚まで。利用者はいつでも取り消せます。
- このトークンで使えるのは、下の3つのAPIだけです。ほかのスライドや利用者の情報は読めません。
- **保存した時点で、URLを知る人はログインせずに閲覧できます。** 秘密・個人情報を入れないでください。

## スライドJSONの形

v2 仕様（[spec.md](v2/spec.md)、[schema.json](v2/schema.json)）のJSONを、そのまま送ります。要点は次のとおりです。

- root は `{"format":"events-lab-deck","version":2,"title":"…","slides":[…]}` の4キーだけ。
- キャンバスは960×540。座標・寸法・fontSize はすべて整数。`x+w≤960`、`y+h≤540`、`w,h≥20`。
- 要素は `text` / `image-placeholder` / `image-url` の3種類。記載したキーはすべて必須で、ほかのキーは付けない。
- `text`: `type,x,y,w,h,text,fontSize(12〜160),font("default"|"serif"|"monospace"),color("#RRGGBB"),bold,italic,align("left"|"center"|"right")`
- `image-placeholder`: `type,x,y,w,h`（画像をまだ置かない枠）
- `image-url`: `type,x,y,w,h,src`。`src` には次のどちらかを使います。
  - 下の画像アップロードが返した `src`（`/api/decks/<deckId>/images/<imageId>` の形。**このトークンのデッキに上げた画像だけ**）
  - 実在する公開のHTTPS絶対URL（自分で作ったURLや、推測したURLは使わない）

## 流れ

1. `PUT /api/agent/deck` にJSONを送ってデッキを作る（画像の位置は `image-placeholder` でよい）
2. 画像があれば `POST /api/agent/deck/images` で1枚ずつ上げ、返った `src` を控える
3. 枠を `image-url` に替えたJSONで、もう一度 `PUT /api/agent/deck` する（同じデッキが置き換わる）
4. 返ってきた `viewUrl`（閲覧）と `editUrl`（利用者が編集する画面）を利用者に伝える

検証エラー（422）が返ったら、`issues[].path` と `message` を読んで直し、**JSON全体を送り直します**。差分は送れません。

## 既存のスライドを直す

利用者が「直してほしい」と言ってトークンを渡した場合、そのトークンは**利用者の既存のスライドに結び付いています**（`GET /api/agent/deck` の `deck` が最初から入っています）。

1. `GET /api/agent/deck` を呼び、`content`（今のスライドの v2 JSON）を読む
2. 頼まれたところだけを直す。直さないページ・要素はそのまま残す（座標・色・書体・画像の `src` も変えない）
3. 直したJSON**全体**を `PUT /api/agent/deck` する（`200` で同じデッキが置き換わる。新しいデッキは作れない）
4. `viewUrl` と `editUrl` を利用者に伝える

- `content` の画像の `src` が `/api/decks/<deckId>/images/<imageId>` のものは、そのデッキに上げてある画像です。そのまま残せば表示されます。
- 利用者は「AIの変更を取り消す」で、あなたが最初に書く前の中身に戻せます。
- `content` は v2 にあるものだけです。回転・グループ・既定以外の書体は v2 に無いので、書き戻すと元に戻ります。`GET` の `losses`（`rotated`・`grouped`・`customFonts`）で何が戻るかが分かります。利用者に一言伝えてください。
- あなたが書いている間（トークンが有効な間）、利用者はそのスライドを編集できません。終わったら、その旨を伝えてください（利用者がトークンを取り消せば、すぐ編集できます）。

## API

### `GET $BASE/api/agent/deck`

トークンの状態を返します。最初に1回呼んで、トークンが生きているか確かめると安全です。

```json
{"expiresAt":1790000000000,"writesLeft":100,"imagesLeft":50,"deck":null,"deckDeleted":false,"content":null}
```

デッキがあれば、`deck` にURL、`content` に今の中身（v2 JSON。`PUT` と同じ形）が入ります。

### `PUT $BASE/api/agent/deck`

`Content-Type: application/json`。本文はスライドJSONの生のUTF-8（1,048,576 bytes以下）。

- 1回目: デッキを作り `201` を返す。
- 2回目以降: 同じデッキの中身とタイトルを置き換え、`200` を返す。

```bash
curl -sS -X PUT "$BASE/api/agent/deck" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @deck.json
```

```json
{"created":true,"id":"…","slug":"…","editUrl":"$BASE/decks/…/edit","viewUrl":"$BASE/d/…"}
```

### `POST $BASE/api/agent/deck/images`

本文は画像の生バイナリ。`Content-Type` は `image/png` / `image/jpeg` / `image/webp` / `image/gif` / `image/avif` のどれか（SVGは不可）。6MiB まで。先に `PUT /api/agent/deck` でデッキを作っておく必要があります。

```bash
curl -sS -X POST "$BASE/api/agent/deck/images" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: image/png" \
  --data-binary @figure.png
```

```json
{"src":"/api/decks/<deckId>/images/<imageId>","url":"$BASE/api/decks/<deckId>/images/<imageId>"}
```

JSONの `src` には、返った `src`（相対パス）をそのまま入れます。

## エラー

本文は `{"error":"<code>", …}` の形です。

| status | error | どうするか |
| --- | --- | --- |
| 400 | `invalid_json` / `invalid_encoding`（`line`,`column`付き） | JSONオブジェクト1個だけを送る。説明文・コードフェンス・末尾カンマ・BOMを外す |
| 401 | `invalid_token` | トークンが違う・期限切れ・取り消し済み。利用者に新しいトークンを頼む |
| 409 | `deck_not_created` | 画像の前に `PUT /api/agent/deck` でデッキを作る |
| 409 | `deck_already_created` | 同時に送った別の要求が先にデッキを作った。同じ `PUT` をもう一度送れば置き換わる |
| 410 | `deck_deleted` | 利用者がデッキを消した。新しいトークンを頼む |
| 413 | `too_large` | JSONは1,048,576 bytes、画像は6MiBまで |
| 415 | `unsupported_media_type` / `invalid_content_type` / `invalid_image` | `Content-Type` と中身をそろえる |
| 422 | `invalid_deck_import`（`issues[]`付き） | `issues[].path` の箇所を `message` に従って直し、全体を送り直す |
| 429 | `write_limit` / `image_limit` | このトークンの上限。利用者に新しいトークンを頼む |

## English summary

Send `Authorization: Bearer evd_…` on every call. `PUT /api/agent/deck` with a version 2 events-lab-deck JSON body ([spec](v2/spec.md)) creates the token's single deck (201), and later calls replace it (200). `POST /api/agent/deck/images` takes a raw PNG/JPEG/WebP/GIF/AVIF body (6 MiB or less) after the deck exists. It returns a `src` that you can use in an `image-url` element. `GET /api/agent/deck` reports the token's state. Tokens last 60 minutes and allow 100 writes and 50 images. The saved deck is viewable by anyone who has its URL. On 422, fix the listed `issues` and resend the whole JSON. If the user gave you a token to edit an existing deck, `GET /api/agent/deck` already returns that `deck` and its current `content` (version 2 JSON). Change only what was asked, keep everything else (including `/api/decks/<deckId>/images/...` srcs), and `PUT` the whole JSON back (200). While the token is active the user can't edit the deck; they can undo your changes afterwards. `content` keeps only version 2 properties: rotation, groups and non-default fonts are reset when you write it back (`losses` in the GET response lists them), so tell the user.
