# 開いている画面への合図（D-POLL-MIN 第5段階）

この文書が契約の正本。型は `packages/shared/src/eventSignal.ts`、送信は
`apps/server/src/lib/eventSignal.ts`、受信は `apps/web/src/lib/eventSignal.ts` と
`ChatRelayPool.subscribeSignal`（`apps/web/src/lib/nostrChat.ts`）。

## 何のためか

定期の取り直し（ポーリング）の代わりに、状態が変わったときにサーバーが Nostr の
ephemeral イベントで「開いている画面」に知らせる。最初の topic は**チャットの非表示・解除**
（`chat-hidden`）。スタッフ・運営が隠した発言を、見ている画面（チャット・投影・配信画面）から
サーバーへの問い合わせなしにすぐ消す。

残りの定期確認（第5段階 b）も同じ合図に topic を足して載せる。

## イベントの形

| 項目 | 値 |
| --- | --- |
| kind | `EVENT_SIGNAL_KIND = 20078`（ephemeral 範囲 20000–29999。27888 鍵証明・27889 表彰・22242 AUTH とは別） |
| 作者 | その環境の公式サービス鍵（`NOSTR_SERVICE_KEY`）。他の作者は無視する |
| tags | `["t", <topic>]`, `["-"]`（NIP-70。送信側がサービス鍵で AUTH する。購読側は AUTH 不要） |
| content | JSON。`rev`（サーバーの epoch ミリ秒・整数）＋ topic ごとの項目 |
| created_at | `floor(rev / 1000)` |

`<topic>` = `HMAC-SHA256(NOSTR_SERVICE_KEY, "eventer/signal/v1:" + <topic名> + ":" + <eventId>)` の hex。
保存する列は無い。event ID も topic 名も読み取れない。`accessRevision` は混ぜない
（参加のたびに変わり、開いている画面の購読がずれるため）。topic は購読の絞り込みであり権限ではない。

### `chat-hidden`

```json
{ "rev": 1760000000123, "hidden": ["<note id>"], "shown": [] }
```

非表示の表は平文・参加者のみ（暗号化）で共通なので、topic も1つ。
送るのは状態が実際に変わったときだけ（`event_chat_hidden` の変更行数 > 0）:

- `POST /api/events/:id/chat-hidden`（スタッフの非表示）
- `DELETE /api/events/:id/chat-hidden/:noteId`（スタッフの解除）
- `POST /api/admin/moderation/events/:id/hide|restore`（`kind: "chat_message"`）

中身はリクエストの内容ではなく、**変更の確定後に読んだその発言の状態**。運営の非表示が残っている
発言をスタッフが解除しても変化は無いので送らない。運営が復元してもスタッフの非表示が残っていれば
`hidden` として送る。`rev` は状態を読む前に取る。

## 購読のしかた

1. 画面を開いたとき、今の HTTP 応答（`GET /chat-members` の `ChatMembersPayload`、
   `GET|POST /encrypted-chat` の `EncryptedChatPayload`）を読む。どちらも
   `hiddenSignal: { kind, pubkey, topic, rev } | null` を持つ。`rev` は応答の非表示リストを
   読む**前**のサーバー時刻。サービス鍵が無い環境では `null`（合図なし。従来どおり）。
2. チャット本文と**同じリレー接続**に合図の購読を並べて張る
   （`{kinds:[20078], authors:[pubkey], "#t":[topic…], limit:50}`、`since` なし）。
   topic が複数あってもリレーごとに REQ は1本。
3. 受けた合図は kind・作者・`t`・署名・JSON を確かめ、`rev <= hiddenSignal.rev` なら捨てる
   （応答に反映済み）。新しいものは発言ごとに最新 `rev` の状態を重ねる（順不同に届いても戻らない）。
   strfry は ephemeral を数分保持し、新しい REQ に EOSE 前に返すが、それらもこの `rev` で振り分けられる。
4. 応答を取り直すと `rev` も新しくなり、重ねた分のうち古いものは使われなくなる。

## 届かなかったとき

保存も再送も無い。送信の失敗、画面側の切断中に送られた合図は失われる。追いつくのは次の取り直し
（タブ復帰・知らない発言者・手動の「もう一度」・自分の操作）。第1段階と同じ。

例外は配信画面（OBS の `/live/screen`）で、誰も触らないので次の取り直しが来ない。そのため:

- 合図の購読が今の接続で EOSE を受けるまで行を出さない。
- EOSE を受けるたびに（再接続のたびに）チャット情報を1回取り直し、それが届くまで行を出さない。
  切断中の合図はこの1回で拾う。定期の取り直しはしない。
- サービス鍵が無い環境（合図なし）では行を出さない。

## 合図にしないもの

- 発言者の締め出し・解除（`/chat-authors/block|unblock`）: 受け取る側は pubkey で隠すことになり、
  利用者と鍵の対応を合図に載せないといけない。第1段階のまま（次の取り直しで反映）。
- 参加・資格の喪失、鍵の世代替え: 開いている画面にすぐ届ける必要は無い。知らない pubkey・新しい
  鍵世代の発言で取り直す第1段階のまま。
- 配信画面のチャットのオフ: 配信設定のオフは従来の1秒ごとの `GET /live-state`。イベント側で
  チャットが使えなくなった（チャットをオフ・非公開化・日程調整に戻した等）場合も、同じ応答の
  `chatSource` が `"off"` になる（共通門が読んだイベント行で判定。追加の読み取りなし）。
