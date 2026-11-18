# お知らせとメールの言語 (#352)

オーナー決定 2026-11-19（案 A）: **お知らせとメールは、受け取る人が最後に使った画面の言語で送る。
設定で言語を選んでいれば、そちらが優先。** 分からない人（まだ新しい画面を開いていない人）は日本語。

## 何を覚えるか（migration 0128）

| 列 | 意味 |
| --- | --- |
| `user.language` | `'ja'` / `'en'`。NULL はまだ分からない（日本語で送る） |
| `user.language_explicit` | 1 = 設定で選んだ言語。画面を開いたときの自動の報告では上書きしない |

## 画面から知らせる（`PUT /api/me/language`）

`{ language, mode }`。`mode` は `packages/shared/src/notificationPrefs.ts` の `LANGUAGE_UPDATE_MODES`。

- `report`: ログイン中の画面を開いたとき（`Layout` の `useReportNoticeLanguage`）。`GET /api/auth/me` の
  `noticeLanguage` と**今の表示言語が違うときだけ**送る。同じなら何も送らない。設定で選んだ人には送らないし、
  サーバーも上書きしない。
- `choose`: 設定（アカウント設定の表示言語）で言語を選んだ。
- `auto`: 設定で「自動」に戻した。選んだ印を外し、今の画面の言語にする。

定期には見張らない（失敗しても、次に開いたときにまた違えば送る）。

## サーバーでの組み立て

文言は `packages/shared/src/i18n/messages/notices.ts`（`notices` 名前空間。画面と同じ辞書）。
日本語はこれまでサーバーに直書きしていた文言そのまま。組み立ては `apps/server/src/lib/noticeText.ts` の1か所:

- JS で作るお知らせは `localized(key, params)` を `notificationsRepo.create` / `createForMany` に渡す。
  宛先の言語を引き、**言語ごとに1回**組み立てて書く。メールも同じ文字列で送る。
  文字列を渡すと、どの言語の宛先にも同じに出る。
- SQL の中で作るお知らせ（参加・抽選・繰り上がり・日程・出会い・閲覧への招待。同じ D1 batch で書くもの）は
  `sqlNotice(langExpr, key, params)` で、宛先の言語の列を見る CASE 式にする。
- 非公開イベントの中立の文言（`genericEventNotice`）も宛先の言語。
- メールの枠（イベントカードのラベル・ボタン・フッター・日時の並び）と前日リマインダーも宛先の言語。
- イベント名・会場名など人が入力したものは差し込むだけで、訳さない。日時は日本時間のまま（並びだけ言語に合わせる）。

ログインしていない人に見せるページ（メールの配信停止・staging のサインイン）は、ブラウザの言語
（Accept-Language）で出す。

## 日本語のままにしているもの

- 管理者だけに届くお知らせ（要確認の検知 `abuse_flag`、新しいお問い合わせ `inquiry_new`）。管理画面と同じく対象外。
- 一斉連絡の題名と本文（運営が書いたもの）。
- Discord / Slack の Webhook（docs/webhooks.md）。チャンネル宛てで、受け取る人が1人に決まらない。
- すでに作られたお知らせ（書いた時点の言語のまま残る）。
