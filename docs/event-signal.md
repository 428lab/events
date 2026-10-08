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
- 配信画面のチャットのオフ: `chat-hidden` には載せない。配信設定のオフは `GET /live-state` の
  `chatSource` で、取り直しは下の `live` の合図。イベント側でチャットが使えなくなった（チャットを
  オフ・非公開化・日程調整に戻した等）場合も、同じ応答の `chatSource` が `"off"` になる
  （共通門が読んだイベント行で判定。追加の読み取りなし）。

## 取り直しの合図（第5段階 b）

残りの定期確認を置き換えるための、中身を持たない合図。`content` は `{"rev": <ms>}` だけで、
受け取った画面は対応するデータを**1回だけ**取り直す。データそのものは載せないので、
非公開・限定公開のイベントでもリレーに出るのは不透明な topic・公式鍵・時刻・`rev` だけ。

### topic

`EventSignalRefetchTopic`（`packages/shared/src/eventSignal.ts`）。topic の値は上と同じ
`HMAC(NOSTR_SERVICE_KEY, "eventer/signal/v1:<名前>:<スコープ>")`。スコープはイベント ID
（`meet-token` だけ利用者 ID）。スタッフ向けの topic（`live`・`scores`・`bingo-staff`・
`prize-desk`・`schedule-editing`・`broadcasts`）は、スタッフ用のエンドポイントの応答でだけ渡す。
topic は購読の絞り込みであり権限ではない（取り直しは通常どおり HTTP の権限で判定される）。

### 送る側（`apps/server/src/lib/eventSignal.ts`）

- `eventSignal.source(scope, topic, rev)`: 応答に入れる購読先。`config` にリレー一覧
  （運用設定 `chat_relays`）を足したもの。サービス鍵が無ければ `null`。
- `eventSignal.publishRefetch([[topic, scope], …])`: 変更の確定後に `deferBackground` で呼ぶ。
  1回の書き込みで複数の topic が変わるときは、`t` タグを並べた**1つの** Nostr イベントにまとめる。
  失敗はログだけ（保存・再送なし）。
- `eventSignal.publishRefetchThrottled(...)`: 投票・読み取り・カード発行など連打されうる書き込み用。
  isolate ごとに topic×スコープで、最初の変更はすぐ、2秒の窓の中の残りは窓の終わりに1回だけ送る
  （同じバックグラウンド処理の中で待つ）。isolate をまたぐと多めに送られることはあっても
  少なくはならない。isolate が先に消えたら次の書き込みが知らせる。

### 受ける側（`apps/web/src/lib/signalHub.ts`）

- `useEventSignal(source, onSignal, { jitterMs, eventId })`。`source` は認証済みの HTTP 応答から。
- タブ全体で**1つの接続**（`ChatRelayPool`、使い捨て鍵。購読に AUTH は要らない）を共有し、
  登録された topic を `#t` に並べた**リレーごとに1本の REQ** にする。topic の増減は 250ms まとめて
  REQ を張り替え、新しい REQ が EOSE を受けるまで古い REQ を残す。最後の topic が外れて
  30 秒たったら接続を閉じる（画面遷移で張り直さない）。
- 受け入れる条件: kind・作者（`source.pubkey`）・`t`・`["-"]`・署名・`rev` が整数、かつ
  `rev` が応答の `rev` とその topic で最後に扱った `rev` より新しい。strfry が EOSE 前に返す
  直近の合図は、応答に反映済み（`rev` が古い）なので捨てられる。切断中に出た新しい合図は拾う。
- 取り直しは topic ごとに同時に1つ。待っている間に来た合図は吸収し、取り直し中に来たら終わってから
  もう1回だけ。`jitterMs` は運営の画面は 0、参加者全員が見る topic は
  `PARTICIPANT_SIGNAL_JITTER_MS`（5秒）まで散らす。
- `event-access-reset` でそのイベントの購読をやめる。
- `synced` は「その topic の REQ が今つながっているリレーで EOSE を受けた」。

チャットの `chat-hidden` は第5段階 a のまま、チャット自身の接続（`subscribeSignal`）で受ける。

### 届かなかったとき

念のための定期確認・再送・保存はしない。次の合図、タブに戻ったとき、再読み込みで追いつく。

### 運営の画面（5b-2）

jitter 0。合図には何も載せない（`{rev}` だけ）。

| topic | 応答（`signal`） | 受ける画面 | 送る書き込み |
| --- | --- | --- | --- |
| `live` | `GET /events/:id/live-state` | `/live/screen`・`/live/control`（`useEventLiveState`） | 配信状態の PATCH・参戦演出・発表者のデッキ設定（`PUT …/timetable/:itemId/live-deck`）・配信中のデッキ／配信セットの削除（FK で外れる行を先に読む）・チャットの可否に関わるイベント設定（`chatEnabled`・`chatEncrypted`・`visibility`・`status`・`scheduling`）・日程調整に戻す |
| `qa` | `GET /events/:id/questions` | 投影（`/chat/screen`）・登壇者パネル（`useEventQa(…, watch)`） | 投稿・投票・取り消し・削除（throttle）／対応済み・非表示・ピック・管理者の非表示と復元・Q&A 設定（即時） |
| `prize-desk` | `GET /events/:id/meet-prizes/status` | 景品デスク（status と引き換え履歴を両方取り直す） | 景品の作成・変更・削除・画像・引き換え・取り消し・1位の確定と解除／出会いの増減（throttle）／ビンゴの抽選・取り消し・終了・リセット・削除 |
| `meet-ranking` | `GET /events/:id/meets/ranking/live` | 投影（`/meet-ranking/screen`）。詳細の小カードは購読しない | 出会いの記録・取り消し（throttle）・ランキング設定 |
| `bingo-staff` | `GET /events/:id/bingo/status` | 抽選コントロール | ゲームの作成・開始・抽選・取り消し・終了・リセット・削除・カード発行（throttle） |

配信画面は `useEventLiveState` の `current`（最後の取得が成功し、`live` の購読が EOSE まで来ている）
が立っている間だけ、チャットの行・参戦演出・LIVE 表示を出す。以前の「5秒より古ければ消す」窓は無い。
サービス鍵が無い環境では `current` が立たないので出さない（`chat-hidden` と同じ）。
