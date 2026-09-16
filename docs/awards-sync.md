# 表彰の更新合図と結果再取得 (#538)

- Issue: https://github.com/428lab/events/issues/538
- 基準: staging `f9983a5bb4b7c0ff572f5c3ee3c42baa55223696`。この文書が設計正本。
- 範囲: 既存表彰待機画面と主催操作。Nostr ephemeral合図＋結果再取得。設計確認後の実装候補。**実リレーでの合図受信が未成立のため配備不可**。main/本番/remoteDBは対象外。

## 利用者の一巡

主催は既存の受賞者割当を保存し、表彰画面の「次を発表」を押す。APIが発表cursorをDBへ保存した後、内容なしの更新合図を出す。開いたままの待機画面は合図を受信して認可済APIからstateとawardsを読み直し、主催と同じcursorのドラムロール→最新受賞者/点数へ進む。結果取得が遅い間は読み込み表示であり「受賞者なし」ではない。演出中の主催の次発表ボタンは無効。リセットで待機へ戻す。新ページは作らない。

## 現行と差分

`EventLayout`→`useEventStream`は2秒pollでstate/progress/summaryのみを再取得する。`useAwards`は定期更新されず、advanceも操作端末のstateだけ更新する。待機開始後に受賞者が保存されると古い結果が残る経路がある。報告時の実機操作順は未再現。`AwardsPage`はcursor増加で各端末の3秒演出を始め、音の自動再生拒否時は即結果へ進む。Nostrだけでなく結果再取得と表示待ち時間の修正が必要。

`live-state`はstaff専用の配信シーン/BGM等の別状態であり変更しない。既存の受賞者通知（アプリ内通知）とも別用途。

## 合図契約

- 表彰専用 `AWARDS_SYNC_KIND = 27889`（ephemeral範囲20000–29999。既存の27888鍵所有証明/22242 AUTH/42参加者chat/9807 staff chatとは別）。履歴・永続queueは持たない。
- `content: ""`, tagsは `e: <opaque topic>`、同秒操作のイベントID重複を避けるランダムnonceのみ。内容なしの合図にはprotected (`-`) タグを付けない。chat/staffメッセージの保護は変更しない。タイトル、賞名、受賞者、点数、event ID、URL、cursorは含めない。
- topic: `HMAC-SHA256(既存NOSTR_SERVICE_KEY, "eventer/awards-sync/v1:" + event.id + ":" + event.accessRevision)` のhex。用途を分けて導出し、新しい保存鍵/列は作らない。topicは権限ではなく購読の絞込み。リレー上の合図の存在・時刻・相互対応は隠せない。既取得topicを知る失効者にも内容は渡らない。
- 署名は既存 `signWithServiceKey`、送信は `nostrRelay.publishToRelays(getChatRelays(), ..., signWithServiceKey)`。成功したadvance/resetのDB書込後のみ `deferBackground`（既存request-local waitUntil）で送る。通信失敗/鍵未設定は操作済みDBを巻き戻さず、既存pollで追随する。新しいrelay URL入力や任意署名APIを作らない。

## APIと認可

- 新設 `GET /api/events/:id/awards-sync` → `{sync: {topic, kind, pubkey, relays} | null}`。公式鍵未設定ならnull。既存の共通event閲覧門＋既存ログイン境界の後に登録し、stateと同じ閲覧範囲にする。購読に秘密鍵を返さない。
- 既存 `GET /state`, `GET /awards` と advance/reset の入出力・role判定を維持する。state/awardsの再取得は既存Cookie認証付きclientを使う。公開イベントでも未ログインstateを新たに許可しない。
- 招待限定の参加者chat禁止は維持。chat-members/chat-key/channelを呼ばず、独立の合図設定を認可して渡す。`requireEventAccess`がAPIの前後で現在資格を確認する。失効/アカウント変更時は既存event access lifecycle/resetイベントで購読・演出を停止し表示を破棄する。

## 待受けと表示

- `AwardsPage`が有効なevent閲覧情報を持つ間だけ表彰専用hookで購読。初期表示は現在stateとawardsを取得し、合図を待たない。初回の実state取得前にcursor=0を既読として扱わず、途中参加は演出なしで現状を表示する。
- 既存 `randomLocalSigner()` を使う。これは投影用画面で使うメモリ内使い捨て署名器で、NIP-42 AUTHにだけ応答する。Nostr拡張・chat参加・保存鍵を不要にする。`ChatRelayPool`はkindと#eを指定できるため同クラスを専用インスタンスで再利用する（同時購読は1つ）。公式author指定を任意引数として追加し、絞込みをrelay filterと受信時双方で確認する。受信hookでも署名・kind・topic・公式pubkeyを検証し、合図からcursorや結果を直接採用しない。
- 合図でstateとawardsを再取得。既存2秒pollは変更せず、cursor変化時もawardsを必ず取り直す。通知が届かない場合も同じ表示処理へ進む。再取得未完了の結果は表示せず、失敗時は取得エラーと再試行を表示する。
- 端末間のずれを縮めるため、cursor更新時の `state.updatedAt`（発表DB書込時刻）から既存3秒演出の残り時間を算出し、音もその経過位置から再生する。新しい時計同期やtimestamp列は追加しない。各端末時計/ネットワーク差による正確なミリ秒一致は保証しない。初回表示は演出せず、同cursorの再通知では再演出しない。通常の1賞ずつの操作を対象とする。
- 音の拒否で表示待ち時間を短縮しない。演出タイマー終了かつ最新awards取得成功後に結果を表示。結果再取得失敗/待機中は旧結果を新cursorの結果として出さない。reset/unmount時はタイマーと音を止める。

## 変更箇所・検証

- server: `routes/awards.ts`、小さな `lib/awardsSync.ts`（設定導出/固定形式発行）。既存署名/relay/runtimeは再利用。
- shared: `awards.ts` の合図設定型・kind・演出時間定数。
- web: `api/awardHooks.ts` と表彰専用購読hook、`AwardsPage.tsx`、`lib/effects.ts`、`lib/nostrChat.ts`の任意authorフィルタ。必要なja/en表示文言のみ。
- 関連テスト: 公開/招待限定の設定API認可、DB保存後の内容なしephemeral発行、鍵未設定/relay失敗、信頼署名/topic検証、開いた待機画面の結果再取得と次の発表・音拒否時表示。
- 確認: 関連testとtypecheck、主催+別ユーザーの通常2画面で保存→発表→演出→結果→次賞。実ブラウザのローカルfixture/mock relay検証と実relay検証を区別して記録する。実sessionを使わない。
- 初回のprotected付き実relay確認では、両既定relayとも購読REQ（kind27889/#e/author）→EOSEの後に送信し、送信側のNIP-42 AUTH成功→再送OK trueまで確認した。しかし購読側はEVENT未受信（CLOSED/追加AUTH要求もなし）。承認されたprotected除去後の再確認でも、`r.kojira.io` / `x.kojira.io` へ対応する実EOSE後に各1通だけ送信し、両方OK trueだが10秒以上の観測窓でEVENT・検証済callbackとも未受信だった。全socketを閉じ、実アプリ2画面検証へは進まず停止した。**原因未確定であり、relay側制約とは断定しない**。実アプリの公式service鍵や実sessionは使わず、使い捨て検証鍵・ランダムtopic・空contentのみを用いた。追加送信・フィルタ緩和・設定変更は停止。

schema移行不要。失敗時は既存pollに戻り、永続状態は既存event_state/award_resultのみ。配備はレビュー・staging確認・本番GOを別々に扱う。

## 確認済みと残条件

- Chromiumの別コンテキスト2画面で既存の主催/参加者UIを使用。待機開始後の受賞者保存→次を発表→3秒演出→最新の受賞者/点数→次賞→リセットをリロードなしで確認した。Nostr拡張なし。HTTPとrelayはfixtureで、実relay成功の証拠ではない。2回の結果表示の画面間差は観測上各1ms（保証値ではない）。
- 音の自動再生拒否でも早出ししないことはeffectsの単体テストで確認。ブラウザ確認では音の拒否は発生しなかった。
- server関連テストは設定APIの認可、非publicでchatを解放しないこと、DB保存後の内容なし署名済みephemeral発行と失敗時の既存state維持を確認する。web関連テストは信頼署名/topic/kind、結果再取得、次賞、初回、取得失敗の再試行、既存pollからの追随を確認する。
- 未完了: 実relayからのEVENT受信、実認可API＋公式送信を含む環境での通常2画面確認、独立レビュー。mock relayの成功やpollでの更新を、Nostrが実利用できたものとして扱わない。stagingへの反映もこのblockerとレビューが解消するまで行わない。
