# 限定公開・招待限定イベント設計 (#526)

- 状態: **設計Draft / 独立レビュー・ユーザー最終承認待ち。実装着手不可**。
- Issue: https://github.com/428lab/events/issues/526
- 正本: このブランチの `docs/private-events.md`。Issue/PRは参照のみとする。
- 調査基準: origin/main `734d78f12133b9c3c8a31e0e754f1560bbbef1ab`。コード・公開Issueのみ調査。実データ・認証情報は未調査。
- 今回は文書のみ。アプリ/DB/migrationの作成・適用、配備、mainマージはしない。未配備PR #524/#525やstagingの独自機能を取り込まない。

## 1. 利用者の一巡（以下は承認対象の具体提案）

「公開状態」と「誰に見せるか」は別の設定にする。`published` のUIは「募集開始」と読み替え、privateを選んだのに「全体に公開された」と誤解させない。

| 利用者の入口・操作 | 結果・画面上の説明 |
| --- | --- |
| 主催者: 作成画面 | 公開範囲をラジオで public「公開」/unlisted「限定公開」/private「招待限定」から選択。初期選択public。下書き保存時から値を保持。作成者のstaff自動登録は現行どおり |
| 公開一覧・検索から探す | publicかつpublishedのみ。ログインしていても他人の非publicは出ない。非publicの件数、絞込候補、写真、受賞・活動履歴も出ない |
| 自分のダッシュボード | 自分のstaff/memberの管理用一覧は非publicも見える。一般公開一覧とは別。公開範囲バッジを常時表示。招待承諾だけの人は「閲覧できる招待限定」に分け、参加済みと表示しない |
| unlistedのURLを開く | publishedなら未ログインでも詳細を閲覧。申込は既存ログインが必要。URL転送を防げず秘密ではないことを主催者と受信者に説明 |
| privateのURLを開く | 許可された本人のみ詳細。未ログイン・別アカウント・失効者にはイベント名も出さない共通404画面。「見つからないか閲覧できません。ログイン/招待一覧へ」。ログイン後に同じローカルパスへ戻す |
| 主催者: 招待管理 | 「閲覧への招待」（既存「運営への招待」と別欄）。既存登録済み@handleを入力→プロフィール名/handleを確認→送信。不変user.idを対象として保存。staff権限は付かない |
| 未登録の受信者 | 先に通常のログインでアカウントを作り、プロフィールhandleを主催者に伝えて招待してもらう。メールアドレス宛招待・メール所有検証・外部ID入力は作らない |
| 招待を受け取る | アプリ内通知から `/event-invites` へ。本人だけが最小情報（イベント名、招待者表示名、期限）を確認し「閲覧を承諾」/「辞退」。日時・場所・参加者等の本体は承諾前に出さない。通知メールは送らない |
| 招待承諾 | 閲覧権だけ成立。member/Entry/枠を一切作らない。下書きなら「募集開始待ち」、publishedなら詳細へ。7日以内に承諾が必要。承諾済み閲覧権には自動期限を設けない |
| 参加申込 | 閲覧可能＋published＋ログインが前提。必須参加アンケート→枠選択→既存join。先着/待機/抽選申込/落選をそのまま区別し、招待＝当選や席確保にはしない |
| 日程調整 | 閲覧権のある人だけ投票可。○/△からの自動登録への説明は維持。確定時に最新閲覧権を再確認し、失効者を登録/通知しない |
| 参加取消 | 既存の取消操作（開催終了前のみ）。席解放・繰上げ・回答削除は維持。private閲覧権は残る。再参加には通常の条件が必要 |
| 閲覧から退出 | privateの「このイベントの閲覧をやめる」。開催前は参加取消と閲覧権失効を原子的に実行。終了後は過去の参加/出席記録を保持し閲覧権のみ失効。新たな招待の承諾まで戻れない |
| 主催者: 招待取消 | pendingを取り消しても参加には影響しない。acceptedは「閲覧を取り消す」と表示し、開催前なら参加も取消/席解放する旨を確認。終了後は参加履歴を残し閲覧だけ失効 |
| 主催者・運営を外す | 閲覧招待取消でstaff/コミュニティ管理者/app adminの権限は消せない。409で専用管理へ誘導。先に既存staffロール変更/コミュニティ権限変更を行う |
| 開催終了 | endsAt経過で公開範囲は変えない。privateの承諾済み閲覧権は残り写真/結果は元の子権限にも従う。新規参加不可。終了後の新規閲覧招待/承諾も可（過去資料の共有用） |
| archived | statusは既存のまま残す。public一覧には出ない。管理者と有効memberのみ閲覧（現行の非published相当）。privateでも招待だけの人は見えない。終了日時の経過とは区別 |
| 削除 | staffの既存削除確認。イベント/招待/閲覧権・イベント内関連通知を削除しR2は既存の回収処理。取得済みのコピーは回収できない |

### 1.1 編集と公開範囲変更

- 作成/編集フォームと詳細・参加確認に常時バッジと説明。表示のみで保護しない。
- public→unlisted/privateは二段階確認。「検索/通知/外部サイト/共有URL/ダウンロード済み情報は回収できません」「参加者チャットは停止します」を表示。
- privateへの変更時は既存の非canceled member（confirmed/waitlist/applied/lost）を閲覧許可対象として保存する。既存の申込状態・枠・回答を変更しない。管理者は別の根拠で閲覧できる。日程投票者・フォロワー・会場提供者は自動招待しない。
- 確認画面は現在のmember件数/投票のみの人数を表示し、後者に招待が必要と説明。旧参加者を黙って追い出さない。変更APIには確認時のaccessRevisionを必須とし、新規参加等で対象が変われば409で再確認。
- private→unlisted/publicは「承諾者以外にも見えるようになる」確認。全閲覧招待行を削除し旧inviteIdを失効させる（後のprivate化へ権限を持ち越さない）。staff招待は別物なので維持。
- unlisted↔publicでもURL/idは変更しない。privateの旧短縮URLでも同じサーバー認可を行う。URLローテーションを認可の代わりにしない。
- `chatEnabled` は非public化と同じ更新でfalseへ。publicへ戻しても自動復活せずstaffが明示的に開設する。
- 複製は元のvisibilityを引き継ぎ**draft**を作る。invite/閲覧権/memberはコピーせず作成者staffだけ。publicへ事故拡大させない。

## 2. 既存実装との照合と範囲

`packages/shared/src/constants.ts` のEVENT_STATUSESはdraft/published/archived、MEMBER_STATUSESはconfirmed/waitlist/applied/lost/canceled。イベントvisibilityは存在しない。photosPublic、membersNote、scheduleAnonymousは子コンテンツの別の制御であり流用しない。

- `apps/server/src/auth/roles.ts`: canViewEventはpublishedを全許可、非publishedはmember/app admin。canManageEventはstaff/app admin/コミュニティowner・admin。既存staff判定はstatusを見ない箇所があるため、新しいイベント境界では非canceledの資格に統一する。
- `apps/server/src/routes/eventStaffInvites.ts` / `db/repositories/eventStaffInvites.ts`: handle指定→user.id、本人承諾でstaffを作る。対象解決と本人受取UXを再利用するが、閲覧招待は別表・別API（staffを付けない）。
- `apps/server/src/auth/providers.ts`, `auth/session.ts`, `db/repositories/identities.ts`, `routes/auth.ts`, `routes/authBluesky.ts`: OAuth等のidentityを内部userへ束ねる現行セッションを使用。プロバイダごとのメールを招待認可にしない。handle変更後もuser.idは同じ。別ログインで別userを作った場合は自動救済せず、既存アカウント連携/統合または正しいアカウントに再招待。
- `docs/schedule-auto-registration.md` / `db/repositories/scheduleRegistration.ts`: 確定受領・参加・Entry・通知をD1 batchで原子化済み。閲覧資格の条件をこのSQL内にも加える。
- #205 は外部参加者チャットの暗号化のみ。イベント全体のvisibility Issueの代替ではない。#339/#444/#513は関連既存契約。関連Issue検索とopen PR一覧に同等のイベント設計はなく #526を作成。

非対象: 汎用ACL、メールアドレス招待、チケット販売、参加者課金、暗号チャット実装、新しい課金サービス、外部配信素材の非公開化、staging差分統合。後述の機能制限を隠して「完全な秘密イベント」とは呼ばない。

## 3. 権限の定義

### 3.1 共通述語

- `isPubliclyDiscoverable(event)` = status=published AND visibility=public。検索/件数/関連一覧のSQLにも同じ条件を適用。ユーザーが当該イベントを見られる場合でも公開一覧には非publicを混ぜない。
- `isEventManager` = 有効なログインuserかつ（非canceled staff、app admin、所属コミュニティowner/admin）。作成者という列だけでは追加バイパスしない（作成時staff行が根拠）。既存の管理上の閲覧は維持し、UIで「運営/コミュニティ管理者/サービス管理者も閲覧可」を明記。
- `hasPrivateAccess` = manager OR event_access_inviteの当該user行がaccepted。privateではmember行単独を閲覧根拠にしない。private化時の互換seedで既存memberを保護する。
- `canViewEvent` = manager OR〔status=published AND (visibilityがpublic/unlisted OR hasPrivateAccess)〕 OR〔statusがdraft/archived AND 有効member AND (visibility≠private OR hasPrivateAccess)〕。
- 閲覧承諾のみは参加者向けmembersNoteやphotosPublic=falseの写真、Q&A、チャット、ビンゴ等を解放しない。常に **イベント閲覧 AND 既存の子コンテンツ条件**。photosPublic=trueは「このイベントを閲覧できる全員に写真を表示」と文言変更。
- `canApplyToEvent` = canViewEvent AND published AND active session。さらに締切/終了/枠/必須アンケート/既存登録の現行条件。staff招待はこれを通さず、既存staffの承諾ルールを維持する。

### 3.2 権限表（published）

| 主体 | public詳細 | unlisted詳細 | private詳細 | 参加申込 | 参加限定子情報 | 編集/招待 |
| --- | --- | --- | --- | --- | --- | --- |
| 未ログイン | 可 | 可 | 404 | 401（privateは先に404） | 不可 | 不可 |
| ログイン済・招待なし | 可 | 可 | 404 | public/unlistedのみ | 既存条件 | 不可 |
| private pending/expired/declined/revoked | 可 | 可 | 404（本人の招待受取画面のみ例外） | private不可 | 不可 | 不可 |
| private accepted、未参加 | 可 | 可 | 可 | 通常条件で可 | 不可（閲覧者公開分のみ可） | 不可 |
| private accepted、有効member | 可 | 可 | 可 | 再送は既存状態 | role/status/出席等の既存条件 | staffのみ |
| private revoked、旧member | 可 | 可 | 404 | 不可 | 不可 | 不可 |
| manager | 可 | 可 | 可 | 管理と一般参加は別 | 子ルートの追加制限維持 | 可 |

サイト管理者/コミュニティ管理者に既存以上のモデレーション権限は付けない。`isConfirmedEventStaff` を要求するstaff-chat/非表示操作等はそのまま。

### 3.3 404/403/401の順序

イベント不存在/閲覧不可は全て404 `{error:"not_found"}`。子IDが別イベント所属でも404。認可前にはサイズ、ETag、件数、機能ON/OFFも返さない。閲覧可能と分かった後の操作権不足だけ403 `{error:"forbidden"}`、ログイン必須は401。本人招待APIはrequireAuth→所有者照合（他人は404）→状態チェック。404はタイミングまで完全等価とは約束しない。

## 4. アクセス面表（現行コードを起点にした変更対象）

以下のsourceは全てrepository rootからの相対パス。`S` = `apps/server/src/`、`W` = `apps/web/src/`、`R` = `apps/server/src/db/repositories/`。パス族の全verb/全子IDを対象とし、列挙したGETだけに門を置かない。

| 経路・露出面 | 現行根拠 | 確定する扱い |
| --- | --- | --- |
| `/api/public/events`, `/past`, `/scheduling`, `/search`、認証済`GET /api/events` | S routes/public.ts, routes/eventCrud.ts; R events.ts | public discovery条件をWHEREへ。count/total/hasMore/検索facetにも同条件。クライアントでの後filter不可 |
| コミュニティ詳細のupcoming/past、たまごの関連イベント/event_count | S routes/public.ts, routes/eventRequests.ts; R eventRequests.ts, events.ts | publicのみ。たまごにリンク済み非publicも名前/id/件数/公開通知を隠す。非public化でたまご自体の利用者自由記述は書換えない |
| 公開プロフィール/年表/受賞/登壇/写真ギャラリー・facet | S routes/public.ts; R eventMembers.ts, eventSchedule.ts, awards.ts, eventPhotos.ts, eventMeets.ts | 非publicは投稿者本人がこの公開APIを呼んでも非掲載。別ユーザーAPIへeventId差込みで漏れない |
| 公開の実績/いいね/XP・OGプロフィール/PNG | S worker.ts, routes/profileCardImages.ts; R gamification.ts, eventLikes.ts, eventMembers.ts, eventMeets.ts | 公開集計にはpublicのみ（件数からも漏らさない）。ゲーム内参加記録は消さない。既存PNGは派生キャッシュなので非public化時に関係userのカード参照を無効化、通常カード生成で再生成。外部保存済PNGは回収不可 |
| `/api/me/events`, `/api/me/bingo-results` | S routes/me.ts; R eventMembers.ts, eventBingo.ts | 本人の管理/参加一覧は非public可だが各event閲覧権を再確認。失効後はイベント情報を除く。過去記録をDBから消す意味ではない |
| おすすめ/注目 | S routes/adminTrending.ts; R trending.ts; W pages/PublicEventsPage.tsx | 最新mainには独立の一般向けrecommendation APIは見当たらない。既存一般リストにpublic条件。adminTrendingは認可済運営用で維持。将来おすすめが増える場合もpublic述語必須 |
| RSS/JSON Feed/ICS `/feed/events.*` | S worker.ts, routes/feeds.ts; R events.ts | publicのみ。フィルタ・過去・日程調整・件数も同じ。非publicの購読URLは新設しない |
| 個人カレンダー追加 | W lib/googleCalendar.ts と利用UI | 閲覧者の明示操作だけ許可。非publicは「タイトル/場所/URLを外部カレンダーへ渡します」確認を挟む。追加済データ/メール転送の回収不可 |
| `/events/:id`, `/e/:slug`, 子画面HTML、`/api/public/events/by-slug/:slug` | S worker.ts, routes/public.ts; W App.tsx | slug解決もcanViewEvent。非publicのHTMLは常に汎用OG（ログイン本人にもイベントOGなし）、noindex/nofollow/noarchive、X-Robots-Tag。不許可HTMLは汎用404。子画面をSPA fallbackでイベント固有メタ配信しない |
| SEO/sitemap/llms.txt | S worker.ts; apps/web/public/llms.txt | 最新mainに動的sitemap/robots生成実装は見当たらない。静的案内は公開feedのみ。将来sitemapはpublicのみ。noindexは検索エンジンへの要請であり認可ではない |
| direct detail、entries/submissions/members/slots/schedule | S routes/eventsPublic.ts, routes/events.ts | 全件canViewEvent。membersNoteは既存canSeeMembersNoteをさらに適用。未承諾者へ参加者名/回答/場所等を返さない |
| image/awards/meet-prizes/image/scores/results/comments/timetable/survey/view | S worker.tsにeventRoutesより前の登録; routes/images.ts, awards.ts, eventMeetPrizes.ts, scoring.ts, eventComments.ts, eventSchedule.ts, eventSurvey.ts, analytics.ts | **workerの前段共通門**で保護。認証済ルートだけの修正では穴が残る。ビーコンも不許可404で集計しない |
| photos/image/video/poster/thumbnail/comments | S routes/eventPhotos.ts; R eventPhotos.ts | canViewEvent AND canViewPhotos。一覧JSONと全派生バイナリに門。photosPublic=trueもprivate認可の迂回不可。HEAD/Range/If-None-Matchも認可を先行 |
| join/解除/member role/attendance/checkin/slot抽選/entries/date投票/確定 | S routes/eventMembers.ts, eventCheckin.ts, eventSlots.ts, eventEntries.ts, eventDateOptions.ts | 共通閲覧門＋既存role条件。書込み時の最新private資格をSQL条件に含める（§7） |
| scoring/award/live/like/meet/prize/bingo/qa/survey/todo/duty/schedule/broadcast/pre-survey/name-card-assets/analytics/staff-invites | S worker.tsのevent関連route登録と各routes/*.ts | `/api/events/:id/*` の共通閲覧門を漏れなく継承し、各既存role/status/子所有者条件を維持。copy元にもcanViewEvent＋既存source staff確認 |
| `/api/events/:id/attendance.csv` とvenue-offersのevent情報 | S routes/attendanceCsv.ts, venueOffers.ts; R venueOffers.ts | privateでは会場提供資格だけで詳細/名簿を渡さない。先に閲覧招待承諾が必要、その上で従来の成立会場運営者条件。会場側オファー一覧は閲覧不可eventのタイトル等を伏せ、業務用offerの状態のみ残す |
| 開催前アンケート `/api/public/pre-surveys/:token` GET/POSTと`/s/:token` | S worker.ts, routes/eventPreSurvey.ts; R eventPreSurvey.ts; docs/pre-event-survey.md | privateでは既存共有tokenの両APIも404（closedタイトルも返さない）。private化でtokenを回転しstatus=closed、public/unlistedに戻しても再開は手動。管理結果はstaff可。unlistedでは独立共有フォームとして既存仕様維持 |
| 参加者チャットAPIと外部WS | S routes/eventChat.ts, lib/nostrRelay.ts; W lib/nostrChat.ts, lib/useEventChatAccess.ts | 非publicでは参加者チャットを使用不可。§5。APIの鍵/channel/memberリスト取得・変更も認可後409 `chat_requires_public`。UIだけで無効化しない |
| staffチャット | S routes/staffChat.ts; R staffChat.ts; W lib/staffChatCrypto.ts; docs/staff-chat.md | 既存の暗号化/確定staff限定を維持＋イベント門。一般閲覧招待では鍵を配らない。staff喪失時の世代更新維持。過去鍵/取得済ログの回収は不可 |
| 通知一覧/未読数/通知メール、リマインダー、一斉メール、フォロワー、日程確定 | S routes/notifications.ts, follows.ts, eventBroadcast.ts; R notifications.ts, scheduleRegistration.ts; S lib/email.ts, reminders.ts, broadcast.ts | §8。非publicを一般フォロワー/たまご賛同者へ流さない。本人・参加者への業務連絡も送信直前に資格確認 |
| 独立素材: decks、deck-images、live-set-images、BGM、会場写真 | S routes/public.ts, deckImages.ts, liveSetImages.ts, bgm.ts, venues.ts; R decks.ts, liveSets.ts, venuePhotos.ts | event_idを持たない独立素材。private化はこれらの公開URLを保護しない。イベントへの参照取得はイベント門で保護するが素材自体は既存公開契約。非publicの素材選択UIで警告。秘密資料はアップロードしない (§5) |
| admin/KPI/監査・コミュニティKPI | S routes/admin*.ts, routes/communities.ts; R communityKpi.ts, kpi.ts | 認証済運営の管理用集計は維持。一般公開APIに転用不可。イベント内モデレーション権限は拡張しない |

### 4.1 共通境界の配置

新規 `S auth/eventAccess.ts` にserver判定/認可済contextを置き、roles.tsのcanViewEventはここを呼ぶ。SQLで必要な資格述語もこのモジュールの同じ仕様から組み立て、別実装の意味を増やさない。

`S worker.ts` の **最初の `/api/events/:id` と `/api/events/:id/*` 登録より前** にイベント解決/optional currentUser/閲覧門を置く。リスト・作成の`/api/events`はこの門の対象外。現在のevents.tsのrequireAuth境界はその後に維持（authを全ルートに重複追加しない）。`currentUser`のリクエスト内キャッシュを使う。HTML/slug/共有アンケート/その他親IDでない経路は明示アダプタを置く。存在しないrouteのfallbackにもevent情報を入れない。

`test/auth-boundary.test.ts` の実ルーター走査に、全event path/verbの不許可privateリクエストが404になるケースを追加する。親IDを持たない間接経路は表にある専用テストで担保する。未知のvisibilityはpublic扱いせずfail-closed。

## 5. 外部チャット・素材・キャッシュの限界

### 5.1 機能制限を伴う提案（最終承認が必要）

現行 `S routes/eventChat.ts` のコメント通り本文はブラウザ⇔リレー直通。`W lib/nostrChat.ts` のkind:42 contentは平文で、NIP-70は暗号化ではない。アプリで鍵配布を止めても既存鍵やchannel IDを使う外部クライアントのWSをサーバーから認可/切断できない。

従って今回の機能設計では **unlisted/privateの参加者チャットは停止**。privateなのに平文へ送る抜け道を残さない。既存clientはaccess再取得を15秒周期、focus/reconnect時と送信直前に行い、非public/失効/認可取得失敗なら購読・再接続を停止して画面データを破棄する。ただし悪意のあるclient/古い配備clientの外部WSは停止保証できない。publicから変更前のチャット本文/channel名やその後の外部投稿も回収不可。#205の暗号化は別承認まで実装しない。

独立した公開スライド/画像/配信素材/会場写真/自由記述の外部リンクは、本件でprivate資料保管庫にはならない。非publicの詳細/編集/素材アップロード入口に「この素材のURLはイベントの招待制限の対象外」と明示。イベントの固有写真/動画は§4の門で保護する。独立素材への機密データ保存も必要なら本設計の範囲を改めて承認し、それまでは保証対象外。PR #524/#525の素材仕様は変更しない。

### 5.2 キャッシュ方針

- 新しい版ではevent由来の可変HTML/JSON/画像/動画/OG応答はpublicであっても `Cache-Control: private, no-store`。公開→非公開遷移を容易にするため共有cache最適化を捨てる。404/403/304/206/416にも適用、`Vary: Cookie` を付与。ETag/Range処理より先に資格を確かめる。R2へ直接公開URLを新設しない。
- 公開一覧/feed/プロフィール等のイベント由来集計もno-storeに変更する。静的JS/CSS/汎用OG/独立公開素材は従来cacheのまま。非public文書にはReferrer-Policy: no-referrer。
- 現行cacheはevent表紙60秒、写真/動画private max-age=3600、公開プロフィールPNG3600秒、独立deck/live画像1年immutable。新headerは既に配信したcacheを書き換えない。導入時に管理下CDN cacheをpurgeし、イベント由来旧cacheの最大TTL（少なくとも1時間、実配備設定も承認時確認）の経過を確認するまで非public作成/変更の公開を止める。独立素材1年は保証対象外。
- クライアントのquery cacheはログアウト/アカウント切替/アクセス退出・取消/visibility変更時にevent・子queryをremove。詳細の15秒再検証＋focus時再検証、失敗時は非publicデータを表示継続しない。localStorageへ新たに本文を保存しない。
- レスポンス開始前/新規Rangeは最新資格で拒否できる。一度開始したHTTP動画stream/保存済ファイル/スクリーンショット/印刷/外部検索cache/メールは回収できない。転送、アカウント共有、管理運営者のアクセスも防がない。**絶対秘密・即時の全端末消去を保証しない**。

## 6. データ・型・不変条件（将来実装時の具体schema）

次の空きmigration番号（調査時は0089まで）を実装開始時に採番し、単一のvisibility/access migrationへまとめる。本PRにSQLファイルは作らない。

```sql
ALTER TABLE event ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public','unlisted','private'));
ALTER TABLE event ADD COLUMN access_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event ADD COLUMN access_operation_token TEXT; -- batch内の条件付き副作用用、API非公開
CREATE INDEX idx_event_visibility_status_start
  ON event(visibility, status, starts_at, id);
CREATE INDEX idx_event_community_visibility_status
  ON event(community_id, visibility, status, starts_at);
CREATE TABLE event_access_invite (
  id TEXT PRIMARY KEY, -- random UUID、bearer credentialではない
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  invited_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined','revoked')),
  source TEXT NOT NULL CHECK(source IN ('invite','existing_member')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER, -- pendingのみ必須。epoch ms
  responded_at INTEGER,
  UNIQUE(event_id, user_id),
  CHECK(status <> 'pending' OR expires_at IS NOT NULL)
);
CREATE INDEX idx_event_access_invite_user_status
  ON event_access_invite(user_id, status, created_at);
ALTER TABLE notification ADD COLUMN event_id TEXT REFERENCES event(id) ON DELETE CASCADE;
CREATE INDEX idx_notification_event_user ON notification(event_id, user_id);
```

- shared `EVENT_VISIBILITIES` / `EventVisibility`、`Event.visibility`、`Event.accessRevision` を追加。createEventInput.visibilityは省略時public、updateEventInput.visibilityはoptional（省略で上書きしない）。未知enum/nullは400。visibilityを含む更新はexpectedAccessRevision必須。
- shared新規 `eventAccessInvites.ts`: 型、Zod入力、`EVENT_ACCESS_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000`。expiresAtはserver clockのみで決め、client指定は受けない。expiredは保存statusを増やさずpendingかつexpires_at<=nowの表示状態。
- 一人一イベント一行。再発行は新id/新expiresAtで同じpairを置換し旧idは404。acceptedへの再発行は409（いったん明示取消）。招待はUUIDを知るだけで行使できない。URL漏えい時の秘密token再発行は不要だが誤招待を取消可能。
- private化のmember seedはsource=existing_member/status=accepted/expires_at=NULL/invited_by=操作者。有効な既存閲覧権は保持し、canceledだけのuserはseedしない。
- source=inviteの承諾時は招待者が現在もactive user/managerであることをSQLで確認。資格喪失は409 `inviter_not_staff`、再招待が必要。**成立後**は招待者の異動で閲覧権を連鎖失効しない。対象者の退会申請中はセッション不成立で即拒否、完全削除でCASCADE。
- アカウント統合では対象user_idを勝者userへ移す。pair重複はrevokedが最優先、次にaccepted、pendingは期限が新しい方、declinedの順。同状態の同時刻はidの辞書順。これで取消を古いacceptedで復活させない。invited_byは単純付替え。既存member統合がstaffを保持するのは別管理権限として維持。
- `R accountMerge.ts`, `userTables.ts` の対象列とFK監査テストを更新。手動リスト監査を回避しない。notification.event_idはuser列ではない。
- 通知の既存event link（`/events/<uuid>` とその子・query）をevent_idに対応付けるmigrationを用意。新しいevent関連通知はevent_id必須（§8）。対応不能な旧メッセージの自由記述中の名前/URLは既に公開済み情報の限界であり推測SQLで書換えない。

## 7. API・状態遷移・競合

全APIはsame-originの既存セッション/入力検証パターンを使用。招待APIは全てno-store。handle lookupは既存staff招待同様exact match＋先頭@除去（新しい一般ユーザー検索APIは作らない）。退会中/対象不明は404 user_not_found、自己招待400、manager対象409 already_manager。

| API（新設は名前をここで固定） | 入力 | 正常応答・状態 |
| --- | --- | --- |
| `POST /api/events` | 既存＋visibility? | 201 {event}。draft作成 |
| `PATCH /api/events/:id` | 既存＋visibility?、変更時expectedAccessRevision、confirmVisibilityChange:true | 200 {event}。rev不一致409 access_changed、確認欠落400 confirmation_required |
| `GET /api/events/:id/access-invites` | manager | 200 {invites:[id,userId,handle,displayName,status,source,expiresAt,createdAt],accessRevision}。statusはexpired表示も含む |
| `POST /api/events/:id/access-invites` | {handle,expectedAccessRevision} | privateのみ。201 {invite,accessRevision}。pending/accepted既存409 already_invited。declined/revoked/expiredなら新id発行 |
| `POST /api/events/:id/access-invites/:inviteId/reissue` | {expectedAccessRevision} | pending/expired/declined/revokedのみ。200 {invite,accessRevision}。旧id消失 |
| `DELETE /api/events/:id/access-invites/:inviteId` | {expectedAccessRevision,confirmCancelParticipation:true}（acceptedの場合） | 200 {ok:true,accessRevision}。pending取消にはconfirm不要。同じrevokedへの再送は200、存在しない/他eventは404 |
| `GET /api/me/event-invites` | requireAuth、cursor?、limit既定20/最大50 | 200 {invites:[id,title,inviterName,expiresAt,status],nextCursor}。本人pendingのみ（期限内）。event詳細の代替レスポンスにしない |
| `GET /api/me/event-invites/:inviteId` | requireAuth＋本人所有 | 200 {id,title,inviterName,expiresAt,status}。expired/declined/revokedはイベント名なし、状態だけ |
| `POST /api/me/event-invites/:inviteId/accept` | 空JSON | 200 {eventId,status:"accepted",canOpenEvent}。同じaccepted再送200、期限超過409 invite_expired、辞退/取消409 invite_unavailable |
| `POST /api/me/event-invites/:inviteId/decline` | 空JSON | 200 {ok:true}。同じdeclined再送200、acceptedは409（退出を案内） |
| `GET /api/me/event-access` | cursor?、limit既定20/最大50 | 200 {events,nextCursor}。現在閲覧可能なacceptedのprivate一覧。draft/archived不可なら本体を返さない |
| `DELETE /api/events/:id/access` | {confirmCancelParticipation:true} | 本人退出。200 {ok:true}。失効後の再送だけはrequireAuth＋当該本人revokedを確認する例外で200、他者は404 |
| 既存detail/join/date-votes/子API | 出力にevent.visibility/accessRevision、detailにcanView/canApply、myAccessStatusを追加 | roleやmembershipに閲覧権を混ぜない。canApplyはUI案内であって認可の根拠ではない |

一覧cursorは(created_at,id)の降順keyset。招待者/対象者のメール・外部identity・秘密鍵等は返さない。招待作成は既存pendingとの競合で409を返し通知二重送信しない。

### 7.1 状態遷移

`none → pending → accepted / declined`、pendingは期限超過でexpired相当、pending/accepted/declined→revoked、expired/declined/revoked→新id pending。accepted→退出/撤回でrevoked。イベントがprivateでなくなれば行を全削除し旧id失効。manager資格はこの状態機械とは別。

- pending作成は参加/投票/Entryを増やさない。acceptedも同じ。参加は既存joinの別遷移。
- 撤回/退出の開催前処理: 既存leaveEvent相当（Entry/参加アンケートを処理し、confirmed participantはcanceled履歴、他の一般role/statusは既存ルールで削除）とgrant revokeを同じD1 batchで実行する。終了後は参加/回答履歴を変更せずgrantのみrevoke。
- manager本人退出/manager対象撤回は409 managed_access。staff降格/退出後は、acceptedが別にある場合のみprivateの閲覧が残る。staff招待の承諾だけで一般閲覧招待行は新設しない。
- grant失効者の過去投票は履歴として保持するが確定時の自動参加対象と通知対象から除外。自動登録結果はstaffへ reason=`access_revoked`/outcome=action_required として表示（元の投票者へ詳細通知しない）。再招待を承諾すれば次の通常申込で参加可能。

### 7.2 原子的判定と再試行

D1の既存batchパターンを使用（`S db/client.ts`）。任意のBEGIN/COMMITを別HTTP呼出しに分けない。新しい課金/汎用transaction基盤は作らない。

1. access_revisionはvisibility/status、招待状態、member作成/取消/role変更で増やす。private化確認が古いmember集合を使わないため、全member書込み（staff招待/抽選/自動参加含む）で同じbatch内に増分する。
2. visibility変更は期待revを条件に更新し、**その更新が成功したbatchだけ**member seed、参加者chat停止、開催前survey閉鎖/token回転、private離脱時の招待削除、公開プロフィールPNG参照無効化を行う。更新数0なら全副作用をしない。
3. D1 batchの所有権は先頭の条件付きUPDATEの `RETURNING` と、後続SQLの `changes()` を専用ガードにするだけでは足りない（後続のchangesが変わる）。既存schedule finalizationのtoken方式に合わせ、§6の短命な `access_operation_token` 列（NULL許可）を使い、先頭UPDATEでランダムUUIDをセット、後続各SQLは一致EXISTS条件、最後に一致時のみNULLへ戻す。batch失敗は全ロールバック。この列はAPIに出さない。
4. 招待承諾はpending/期限/target user/招待者資格/privateを条件にUPDATE。statusと閲覧権が同じ行なので「承諾したが権限なし」は生じない。reissue/revokeと同時ならD1の先勝ち。revokeはacceptedにも作用するので承諾直後の撤回も最終的に失効する。
5. join・投票・参加アンケート・抽選・繰上げ・Entry作成は、書込みSQLのEXISTSで最新event/active user/private acceptedかmanagerを確認。HTTP middlewareの読取りだけを信じない。member結果からEntryを作る既存の分割箇所は同じbatchに寄せて、取消後の孤児Entryを防ぐ。
6. 日程確定は既存scheduleRegistrationの一括SQLに資格を追加。参加者選定時と通知SQLの両方で検査。既存受領再送は保存済結果を返し再参加/再通知しない。既存の定員順序（初回答日時、同時はuser ID）、抽選/複数枠/必須アンケート/取消履歴は維持。
7. 撤回と席解放は原子的。繰上げは既存waitlistの条件付きUPDATEを再実行可能にし、失効者は飛ばす。通知は状態が実際に遷移した場合だけ作る。処理中例外でrollbackしたら5xx、同じ入力を再送可。通信切断後も上記idempotent応答を返す。409は自動blind retryせずUIで再取得/再確認。
8. コミュニティ資格変更/退会は他表のためrevだけに依存しない。manager資格/active userも書込SQL内で再評価。read済responseや開始済streamまで撤回しない。

## 8. 通知・公開の副作用

- 一般向けフォロワー作成/参加通知、たまご賛同者への公開通知はpublic/publishedのみ。claimFollowersNotifyにも条件を含める。private/unlisted→publicで初めてdiscoverableになる時は従来の初回一度だけ通知、再public化ではfollowers_notified_atを戻さない。
- 新規閲覧招待はevent_id付き **アプリ内のみ** の専用 `event_access_invite` 通知（招待一覧へ、本文は「閲覧への招待が届きました」の汎用文）。create/再発行と同じbatchで一度だけ保存し既存create()の自動メールを通さない。期限切れ/取消通知は画面上で汎用表示し名前を出さない。
- 新規event関連通知はevent_id必須。通知repoの一覧/未読数は現在の資格をSQLでfilterする。非public一般通知の受信者はmanager、有効memberかaccepted閲覧者に限る（業務対象の絞込みはさらに既存条件）。pending招待通知は本人受取資格で例外。既存staff招待もprivateでは汎用通知とし本人の招待一覧だけに最小情報を表示。
- 開催リマインダー/日程確定/一斉連絡は現行の対象者・設定を維持した上で最新資格を追加。`S lib/broadcast.ts` のキュー消化時にも再検査し失効分を送らず処理済/skipにする。privateメールは画像/会場/参加者一覧/詳細本文を載せず「イベントの更新があります」＋ログイン先URLのみ。主催者自由入力の一斉連絡本文もprivateメールには載せずアプリ内で読む。unlistedもフォロワー大量告知はしないが対象者業務メールは従来本文可。
- 送信直前判定と外部メール送信は単一DB transactionにできないため、その間の失効競合は残る。privateメールを汎用にすることで内容漏えいを小さくする。旧public時に送信/保存済みのメール・push通知・既に表示された通知は回収不可。
- 公開プロフィールのPNGアップロードはクライアント生成cacheである (`S routes/profileCardImages.ts`)。非public化時に既存参照を無効化するが、利用者が古い画像/内容を再アップロードする行為まで禁止しない。公開素材に秘密を手動で書いた場合は保証対象外。

## 9. 互換・導入・切戻し

1. DEFAULT publicで既存全イベントの公開範囲は維持。status、参加枠、回答、写真設定のdataは変換しない。unknown visibilityをpublicへ自動矯正しない。
2. 実装時はschemaと全読取り経路の認可対応を先に用意し、非public作成/更新入口は閉じて検証する。旧serverと非publicを扱うserverの混在期間を作らない。入口開放は別途配備承認後、cache旧TTL経過・全アクセス面gate成功後のみ。
3. migration番号の再確認/空DB・旧schema fixtureでの適用/foreign_key_checkは実装PRで行う。本設計PRでは実DBを照会しない。
4. 旧clientはvisibilityを送らなければpublic作成、既存編集はvisibilityを維持。更新repoが全rowを書き戻す箇所 (`R events.ts`) は古いreadでvisibilityを上書きしないよう変更対象。非public処理に対応しない旧clientもserverの認可で拒否される。
5. 失敗時は入口を閉じる。**非publicを知らない旧serverへrollback禁止**（published扱いで漏れる）。認可対応済み版へforward fix/切戻し。必要ならイベントAPI/HTML/メディアを一時メンテナンス404にしてから復旧する。privateをpublicへ変換して復旧しない。
6. schemaの列/表はadditiveのまま保持し、down migrationで権限dataを捨てない。バックアップ復元にも公開範囲と招待状態が一組で必要。古いバックアップでrevokeが戻り得る場合は復旧前に非publicを閉じて運営確認する。
7. migration/配備/本番操作はこの設計承認とは別承認。現在のユーザーcheckout・staging・productionを操作しない。

## 10. 将来の有料化（ユーザーの事業意図）

非publicは宣伝効果が見込めない一方、需要があるため将来有料化したい。**unlisted/privateの主催者向け利用資格**を候補とする。価格・課金単位・初期無料・開始時期を本書では確約せず、決済プロバイダ/請求/課金表/汎用billingを追加しない。

- 将来の判定境界はserverの「非public新規作成」と「public→非publicへの変更」の入力受理直後、DB変更前。呼出し主体の主催利用資格判定とcanViewEventは別契約。閲覧/joinは主催者契約への照会に依存させず、参加者の契約を要求しない。
- 今回は将来境界を文書で定義するだけでダミーentitlement providerや課金フラグを足さない。今回のvisibility機能の初期提供条件（無料提供か、利用者限定か、課金導入後か）はリリース前のユーザー承認事項。
- 契約終了/失効/支払失敗で **既存イベントを自動public化しない**。閲覧者のアクセスを課金理由で広げない、秘密情報や退会/取消操作を人質にしない。
- 将来導入時の安全な推奨案: 失効後は非publicの新規作成/新規非public化だけ制限。既存イベントの閲覧、開催継続、内容編集、既存招待の再発行、取消/退出/削除は維持。既存privateへの新規招待も運営継続のため維持を推奨する。
- 将来有料導入前に決めること: 課金主体（個人/コミュニティ）・所有権移管・料金/期間/無料枠・猶予期間・既存利用者の移行・新規招待の上限/失効時扱い。ここは今回の認可schemaへ未決定分を混ぜず、将来の別Issue/設計承認で決める。

## 11. 実装変更箇所と受入条件

### 11.1 将来の変更箇所（このPRの変更ではない）

- shared: constants.ts/schema.ts/index.ts、eventAccessInvites.ts、notification型とi18n。visibility/accessRevisionを全Event mapperへ追加。
- server: §4のroute/SQL全系統、auth/eventAccess.ts、roles.ts、worker.ts/events.ts、eventAccessInvites route/repo、member/日程確定/通知/accountMerge/userTables、migration。1ファイル800行規約を守り認可をrouteへ複製しない。
- web: CreateEventPage/EditEventPage、詳細/EventLayout/一覧カード/ダッシュボード、App.tsx、StaffInvitesPageを参考にEventInvitesPageと主催者招待管理、API hooks/cache、googleCalendar確認、チャット利用判定、公開プロフィール集計/画像更新、ja/en文言。
- 既存設計: docs/pre-event-survey.md, schedule-auto-registration.md, staff-chat.md等の契約差分を実装PRで同期（今は変更しない）。

### 11.2 リスクに比例した実装時必須受入

| リスク | 受入シナリオ・証拠 |
| --- | --- |
| 入口がつながらない | 作成→下書き→招待→別アカウントログイン/登録→受取→承諾→募集開始→閲覧→アンケート/枠選択→参加→取消→再参加→退出/再招待→終了までja/en UIで確認。招待承諾時にmember/Entry/席が増えない |
| IDOR/子API漏れ | 実router全event path/verb、HTML/slug/画像/動画/poster/thumbnail/Range/HEAD/ETagに対し未ログイン/別user/pending/expired/revoked/退会中/別event子IDで同一404。既存publicの匿名閲覧が401へ退行しない |
| 公開発見経路の漏れ | 全3visibilityをfixtureに入れ、一覧/検索/count/facet/profile/年表/受賞/XP/写真/コミュニティ/たまご/feeds/ICS/OG本文に非publicのid・タイトル・会場・写真URL・件数が出ない。本人公開profileも同じ。本人管理一覧には許可分だけ残る |
| 子権限の過剰付与 | accepted未参加はmembersNote/参加者限定写真/出席限定写真/ビンゴ/Q&A/staff-chat不可。photosPublic=trueも未招待者不可。会場manager単独でprivate名簿不可、招待承諾＋成立会場資格で可 |
| 招待の横取り/再生 | 他userで同一invite URL/IDを行使不可、handle変更でも本人に結び付く。7日期限境界、再発行旧id、辞退/取消/退会/招待者降格、再送idempotency、別provider user、account merge重複取消優先 |
| 参加と資格の競合 | accept/revoke、join/revoke、private化/join、定員最終1席の同時join/日程確定、取消/繰上げ、reissue/acceptを並行テスト。SQL最新資格、定員非超過、孤児Entryなし、acceptedのみの席消費ゼロ |
| 日程自動参加の漏れ | ○/△のみ、複数枠/抽選/必須回答/取消済/退会中/失効者は既存ルール＋資格で除外。確定再送で二重登録/通知なし、失効者へ結果メールなし |
| 通知/メール漏れ | private/unlistedのfollowee作成/参加通知ゼロ、たまご公開通知ゼロ。queued一斉メールの失効skip、private本文汎用化、旧eventリンク通知の権限filterと未読count一致、期限切れ招待にevent名なし |
| キャッシュ/外部接続 | public→privateで管理下cache purge/旧TTLの確認、非publicレスポンスno-store、ETagで404を304にできない、新規Range拒否。アカウント切替でquery cache破棄。非publicで参加者chat API不可/公式client購読停止、外部旧WSの限界説明表示 |
| 失敗/移行/復旧 | migration前fixture全件public、foreign_key_check、user FK監査/account merge。batch途中の意図的例外でvisibility/grant/member/通知全rollback。旧serverへrollbackしない手順と入口停止を検証 |
| 将来課金と認可の分離 | 課金未導入で決済依存なし。将来利用資格失効の仕様レビューで自動public化/閲覧者課金/取消禁止が入らない。初期無料をUIに未承認で表示しない |

認可の共通門・public SQL条件・join書込み時資格条件をそれぞれ隔離コピーで一箇所外し、対応するテストが落ちる変異証拠を実装レビューに添える。アプリ全テストが本設計PRの検証条件ではない。文書はdiff/link/source存在/行数/Markdown静的検証のみ、既存PR自動CIは許容。

## 12. 承認ゲートと未決定の区別

実装担当に選択を委ねないため、本書は単一の推奨案としてAPI/期限/権限/互換/競合を固定した。以下は**実装時判断ではなく、このDraftのユーザー最終承認項目**。異なる選択なら先に正本を更新して独立再レビューする。

1. 登録済みhandle→user.id招待、7日、受取/閲覧のみ承諾、未登録者は先に登録する最小UX。
2. unlisted/privateの参加者チャット停止（暗号化#205は後続）、独立公開スライド/配信素材は秘密資料として扱えない機能制限。
3. 既存memberのprivate化時閲覧維持、管理者/コミュニティ管理者の閲覧維持、取消と閲覧退出の分離、承諾済招待の撤回時の参加取消。
4. privateで開催前共有アンケート停止、会場提供者にも閲覧招待を要求、private業務メールは汎用文とする変更。
5. 将来有料化の事業意図と上記境界。将来の価格未定は認可の技術判断の穴ではないが、初期提供条件はリリース前に別途確定する。

この5点と独立レビューの承認が済むまで実装不可。アプリ実装・DB・配備・mainマージの承認は本設計PRとは別。レビュー完了前のworktreeはレビュー用に保持する。
