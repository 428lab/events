# 公開プロフィールの連携アカウントリンク

オーナー決定（2026-10-31）:「プロフィール画面でそれぞれの連携したSNS等にリンクで飛べるようにして欲しい。アカウントを公開するかどうかは本人が選べるようにして欲しい。オプトイン方式にしよう」

## 使う人の流れ

1. アカウント設定の「ログイン方法（連携）」で、連携している行の下に **「プロフィールに表示する」** のスイッチが出る。最初はすべてオフ（既存の連携もオフ）。
2. スイッチの横に、オンにしたとき実際に出るリンク（`@octo-cat` など）が見えるので、何が公開されるかを押す前に確かめられる。
3. オンにした連携だけ、公開プロフィール（`/users/:handle`）の名前の下に、アイコン付きのリンクとして並ぶ。未ログインの人にも見える。外部サイトなので新しいタブで開き、`rel="me"` を付ける。
4. オフに戻すか連携を解除すると、すぐ消える。

## 連携先ごとの扱い

| 連携先 | 出すか | URL | 使うデータ |
|---|---|---|---|
| GitHub | 出す | `https://github.com/<login>` | ログイン・連携のたびに保存する login（`identity.public_handle`）。数値IDでは開けないため |
| X | 出す | `https://x.com/<username>`（無ければ `https://x.com/i/user/<数値ID>`） | ログイン・連携のたびに保存する username |
| Bluesky | 出す | `https://bsky.app/profile/<DID>` | DID（識別子）。ハンドルは変わるので URL には使わず、表示にだけ使う |
| Nostr | 出す | `https://njump.me/<npub>` | 公開鍵から npub を作る |
| Google | 出さない | — | 公開プロフィールが無い |
| Discord | 出さない | — | `discord.com/users/<id>` は同じサーバーにいる人など一部にしか開けず、知らない人には開けないリンクになる |

新しい OAuth の権限（scope）は足していない。名前は今までのログインでもう受け取っている値を保存するだけ。

**この機能を出す前から連携している GitHub / X は、名前がまだ保存されていない。** その連携は「アカウント名がまだ分からないため、表示できません。一度このログイン方法でログインし直すと表示できるようになります」と出て、スイッチはオンにできない（X は数値IDの URL を作れるのでオンにできる）。

## データ

- `identity.profile_public INTEGER NOT NULL DEFAULT 0` — 本人のオプトイン。ログインや連携のやり直しでは変わらない。
- `identity.public_handle TEXT` — 連携先のユーザー名（表示とリンク用）。ログイン・連携が成功するたびに上書きして、連携先で名前を変えても追いつく。引き取りや統合に失敗したとき（`link_error`）は書かない。
- migration: `0117_identity_profile_links.sql`

どちらも `identity` の列なので、アカウント統合では行ごと勝ち側へ移り（公開の選択もそのまま）、退会の完全削除では user 行と一緒に消える（FK CASCADE）。user を参照する列は増えないので `userTables` の登録は要らない。

## API

- `GET /api/public/users/:handle` に `links: { provider, url, label }[]` を足した。**`profile_public = 1` の連携だけを SQL の段階で絞り**、リンクを作れない連携は落とす。オフの連携の ID・名前・メールは応答に出ない。
- `GET /api/auth/identities`（本人）に `profilePublic` と `profileLink`（出したときのリンク。出せなければ null）を足した。
- `PUT /api/auth/identities/:provider/profile-public` `{ profilePublic: boolean }`（本人のみ、requireAuth）。リンクを出せない連携先は 400、自分にその連携が無ければ 404。

URL の作り方は `packages/shared/src/profileLinks.ts` が唯一の定義。

## 入れていないもの

- 連携していない SNS（ログインに使わないもの）を手で書き足す欄
- Discord・Google のリンク
- 連携先のプロフィールを取りに行って名前を最新にする仕組み（名前は次のログインで追いつく）
