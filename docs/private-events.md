# 限定公開・招待限定イベント設計 (#526)

- 状態: **実装中 / 配備不可**。設計レビュー完了後の停止は、利用者の実装再開指示により解除。§12の提案どおり実装する。初期提供条件・配備・実データ変更は別承認。
- Issue: https://github.com/428lab/events/issues/526
- 正本: このブランチの `docs/private-events.md`。Issue/PRは参照のみとする。
- 調査基準: origin/main `734d78f12133b9c3c8a31e0e754f1560bbbef1ab`。コード・公開Issueのみ調査。実データ・認証情報は未調査。
- 実装基準: origin/staging `c0cbf643790b7a0b7d304d32679d4e0c5986b456`（参加枠別表示修正を含む）。設計正本は `f5fb2a84922f024ab37c1aa8ae87db81452f0b12` から文書だけを引き継ぐ。元checkout・環境ブランチ・実データは変更しない。

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
| 閲覧から退出 | privateの「このイベントの閲覧をやめる」。本人のaccepted行が根拠であり、draft/archivedで本体が見えなくても `/event-invites` の「承諾済みの閲覧権」から退出可能。開催前は参加取消と閲覧権失効を原子的に実行。終了後は過去の参加/出席記録を保持し閲覧権のみ失効。新たな招待の承諾まで戻れない |
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
| 公開の実績/いいね/XP・OGプロフィール/PNG | S worker.ts, routes/profileCardImages.ts; R gamification.ts, eventLikes.ts, eventMembers.ts, eventMeets.ts | 公開集計にはpublicのみ（件数からも漏らさない）。ゲーム内参加記録は消さない。§6.1の局所寄与user集合について、非public化と同じtransactionでuser別カード世代を回転。§5.3の現行世代のみ配信し、旧組合せ/legacyを再生成で復活させない。外部保存済PNGは回収不可 |
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
| `/api/meet/scan`, `/api/meet/undo`（親event IDのないQR経路） | S worker.ts, routes/eventMeets.ts; R eventMeets.ts; S lib/meetToken.ts, lib/usedNonce.ts | §7.3。共通event選定・診断SQL・各書込み・応答/undoToken・通知に双方の最新canViewEvent。終了後もconfirmed履歴が残る失効eventは対象外。複数共通eventの一部失効はそのeventだけ除外 |
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

`S worker.ts` の **最初の `/api/events/:id` と `/api/events/:id/*` 登録より前** にイベント解決/optional currentUser/閲覧門を置く。リスト・作成の`/api/events`はこの門の対象外。現在のevents.tsのrequireAuth境界はその後に維持（authを全ルートに重複追加しない）。`currentUser`のリクエスト内キャッシュを使う。HTML/slug/共有アンケート/`/api/meet/scan`・`/undo`等の親IDでない経路は明示アダプタを置く。存在しないrouteのfallbackにもevent情報を入れない。

唯一の本人退出例外は **DELETE `/api/events/:id/access`だけ** を共通閲覧門より前に登録し、requireAuth→event存在と本人accepted/revoked行所有→manager拒否→§7の退出処理で閉じる。GET/他verb/他の子APIには例外を適用しない。draft/archivedの本体閲覧不可を維持したままaccepted本人の退出とrevoked本人の再送を許す。共通門はこの一致済みハンドラ以外を一切素通しにしない。

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

### 5.3 プロフィールPNGのuser別世代（レビューP1-2修正）

現行 `S routes/profileCardImages.ts` はcomboごとのR2キーとlegacyキーを持つがGETの門はuser共通cardImageUpdatedAtだけ。参照クリア→Aだけ再生成で旧Bが復活するため、時刻クリアだけでは不十分。以下を一つの配信契約にする。

- `user.card_image_generation` は128bit乱数32hex（作成時も必ず採番）、変更時に再利用しない。R2は `profile-cards/{userId}/generations/{generation}/{combo}.png`。従来のcombo/legacyキーは新しいGETから一切参照しない。旧全組合せは物理削除の成否によらず到達不能。
- 公開プロフィールAPI（カード生成データ取得元）に `cardImageGeneration` を追加。generationを先に読む→既存public集計を実行→同じuserのgenerationを再読取りし、不一致なら本文を返さず409 `card_generation_changed`。一致した集計とgenerationを同一payloadで返す。これは世代更新を伴うvisibility/寄与関係更新と交差したsnapshotを棄却するため。全体時計による統計の即時同期までは要求しない。
- `W pages/LicenseCardPage.tsx` はこのpayload一式からSVG/PNGを生成し、非同期生成開始時のgenerationを保持して `PUT /api/me/card-image?k={combo}&g={generation}` の生PNGで送る。表示payloadが変われば古い生成を破棄。uploadedVariantsRefは(userId,generation,combo)単位。409なら同じPNGへ新世代を付け替えず、profileを再取得しSVGから生成し直す。
- PUTはactive本人・combo/MIME/sizeに加えてg必須（欠落400 generation_required、不正形式400 invalid_generation）。①現在世代一致を確認 ②指定世代のR2キーへ保存 ③ `UPDATE user SET card_image_updated_at=?, card_image_key=? WHERE id=? AND card_image_generation=? AND deleted_at IS NULL` のCAS。更新0件なら409 card_generation_changed（または退会後404）、保存した旧世代をbest-effort削除して終わり。成功200 `{ok:true,updatedAt,key,generation}`。新世代をserverが勝手に代入して旧bodyを採用しない。
- visibility変更が①②③のどこに割り込んでも旧PNGは新世代のキーに置かれない。③成功後の変更は同じuser行の世代回転＋updatedAt=NULLで失効する。同一世代/同一comboの通常並行uploadはlast-write-wins（同じ公開資格snapshotの画像であり秘密の旧世代復活とは別）。
- GET `/api/users/:id/card-image?k={combo}&g={generation}&v={updatedAt}` はactive user・生成済みupdatedAt・gが現在世代と一致することを確認し、現在世代の指定comboだけ取得（存在しないcomboは404、別combo/legacyへfallback不可）。g省略の旧URLは現在世代のみへ解決し、k省略は選択中comboのみ。不正g/kは404。旧g明示は常に404。A再生成後でも未生成Bは404で、Bを新世代で生成した後なら旧gなしB URLは新Bだけを返す。
- R2取得後にも世代を再確認してから200/HEAD/304を返す。不一致はbody破棄して404。ETagは世代/combination/updatedAtを含み、判定前に304を返さない。全PNG応答と拒否はno-store。OG注入は現行generationの生成済みcardだけ新g付きURLを採用、未生成なら汎用OG。送信開始後の画像streamを回収する保証はしない。
- 世代回転ではupdatedAtだけNULL化し、cardImageKeyの選択は残す。新世代に一枚もない間は汎用OG。user別の局所失効集合/過去寄与への対策は§6.1。全ユーザー共通世代は採用しない。

## 6. データ・型・不変条件（将来実装時の具体schema）

migrationは `0091_private_events.sql`。実装基準は0089までだが、未統合のdeck importが0090を使用するため衝突を避ける。0090のコード/SQLは取り込まない。0091の検証はローカルの空DB/旧schema fixtureのみで、リモート適用は行わない。

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
ALTER TABLE user ADD COLUMN card_image_generation TEXT NOT NULL DEFAULT '';
-- 旧PNGとの互換は配信ではなく一度の再生成。世代は128bit乱数32hex、再利用しない。
UPDATE user SET card_image_generation = lower(hex(randomblob(16))),
  card_image_updated_at = NULL;
```

- shared `EVENT_VISIBILITIES` / `EventVisibility`、`Event.visibility`、`Event.accessRevision` を追加。createEventInput.visibilityは省略時public、updateEventInput.visibilityはoptional（省略で上書きしない）。未知enum/nullは400。visibilityを含む更新はexpectedAccessRevision必須。
- shared新規 `eventAccessInvites.ts`: 型、Zod入力、`EVENT_ACCESS_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000`。expiresAtはserver clockのみで決め、client指定は受けない。expiredは保存statusを増やさずpendingかつexpires_at<=nowの表示状態。
- 一人一イベント一行。再発行は新id/新expiresAtで同じpairを置換し旧idは404。acceptedへの再発行は409（いったん明示取消）。招待はUUIDを知るだけで行使できない。URL漏えい時の秘密token再発行は不要だが誤招待を取消可能。
- private化のmember seedはsource=existing_member/status=accepted/expires_at=NULL/invited_by=操作者。有効な既存閲覧権は保持し、canceledだけのuserはseedしない。
- source=inviteの承諾時は招待者が現在もactive user/managerであることをSQLで確認。資格喪失は409 `inviter_not_staff`、再招待が必要。**成立後**は招待者の異動で閲覧権を連鎖失効しない。対象者の退会申請中はセッション不成立で即拒否、完全削除でCASCADE。
- アカウント統合では対象user_idを勝者userへ移す。pair重複はrevokedが最優先、次にaccepted、pendingは期限が新しい方、declinedの順。同状態の同時刻はidの辞書順。これで取消を古いacceptedで復活させない。invited_byは単純付替え。既存member統合がstaffを保持するのは別管理権限として維持。
- `R accountMerge.ts`, `userTables.ts` の対象列とFK監査テストを更新。手動リスト監査を回避しない。notification.event_idはuser列ではない。
- 通知の既存event link（`/events/<uuid>` とその子・query）をevent_idに対応付けるmigrationを用意。新しいevent関連通知はevent_id必須（§8）。対応不能な旧メッセージの自由記述中の名前/URLは既に公開済み情報の限界であり推測SQLで書換えない。

### 6.1 PNG寄与user集合と過去関係（user別失効の根拠）

実際のPNG生成は `W pages/LicenseCardPage.tsx` → `components/licenseCard/cardData.ts:toCardData` → LicenseCardSvg。event由来の入力はparticipation.attended/noShow/hosted/spoken、gamification(level/XP/badges)、communities.myEventCountによる並び。`R eventMembers.ts:participationStats`、`gamification.ts:statsForUser`、`communities.ts:listForUser` のSQLが根拠。cardDataはentries/awards/eventPhotosを読まないので、受賞者/写真投稿者の依存を推測で追加しない（一般プロフィールJSONの認可filterは別に必要）。

局所集合 `cardContributors(eventId)` は以下のUNION（重複除去）とする。現時点のconfirmed/公開日程/有効4人/終了済み/active条件で絞らず、過去の寄与を見落とさない保守的集合。NULL・存在しないuserを最終JOINで除くが退会申請中userも更新する。

```sql
SELECT user_id FROM event_member WHERE event_id = :eventId
UNION SELECT speaker_user_id FROM event_schedule_item WHERE event_id = :eventId
UNION SELECT target_key FROM event_like
  WHERE event_id = :eventId AND kind IN ('host','staff','participant')
UNION SELECT user_low FROM event_meet WHERE event_id = :eventId
UNION SELECT user_high FROM event_meet WHERE event_id = :eventId
```

主催/スタッフ/参加率とcommunity.myEventCountはmembershipで包含（`R communities.ts:listForUser` のmy_event_countと、コミュニティ抽出WHERE内のevent_member由来UNIONの両方へpublic/publishedをANDし、非publicによるカードの並び/所属表示を防ぐ。本人の明示community_member由来所属は維持）、memberでなくても登壇はspeaker、被いいね/出会いのXPはtarget/両端で包含する。いいね送信者は自分にXPを得ないが、その退会による受信者XP変化のevent特定には `event_like.user_id` を使用する。membership数による有効4人の判定の変化も当該eventの全寄与userを失効させる。

**現存関係だけを非public化時に拾う方式でも過去のPNGを完全には特定できない。** 現行 `R eventMembers.ts:remove`、`eventSchedule.ts:saveAll` の削除/担当置換、`eventLikes.ts` のtoggle削除、`eventMeets.ts:deleteMeet` は関係を消す。そこで汎用依存履歴表は作らず、次の局所失効を導入条件にする。

1. 導入migrationで全旧combo/legacyを一度隔離し新世代へコピーしない（§9）。旧版で消えた関係の履歴は復元不能だが、その時代のPNGは以後配信しない。これは導入時の一度限りの互換変更であり、毎回全員失効する方式ではない。
2. 導入後、eventのvisibility/status/削除に加え、上の寄与関係の作成/更新/削除、日時・出席設定/出席・role/status・日程公開条件・community紐付けの変更は、変更**前**のcardContributors集合のuser世代を回転し、次に本体更新、変更**後**の集合も回転する同一D1 batchにする（同じuserが二度回転しても中間世代はtransaction外に出ない）。visibility変更のCAS失敗時は回転しない。event削除/CASCADEは削除前の集合だけ回転する。これで関係を失った元speaker/member/like対象/meet相手の旧画像も関係が消える時点で失効し、後の非public化で追跡し直す必要がない。
3. 書込み元には通常join/leave/抽選/staff招待、日程確定batch、timetable編集、like、meet scan/undo、管理モデレーション・アカウント削除/統合も含む。退会/統合はmembership/speaker/like（送信者とtarget）/meet両端から関連eventを変更前後に抽出し、そのeventの集合を回転する。統合でuser.cardImageGeneration/旧PNGを勝者へコピーせず、勝者自身も新世代にする。関係破壊をraw SQLで世代処理なしに行う経路は実装受入不可。
4. publicから非publicへの変更は当該eventのこの集合だけを回転し、無関係userの世代/PNGを維持する。少なくとも関係数に比例するD1更新であり全user走査はしない。世代更新は `UPDATE user SET card_image_generation=lower(hex(randomblob(16))), card_image_updated_at=NULL WHERE id IN (...)`、user PKと既存event関係索引を使用する。
5. 境界sourceは上記SQL/mapperと `R userAvatars.ts:setCardImage`, `users.ts`, `accountDeletion.ts`, `accountMerge.ts`、shared UserProfile型。user作成時も新32hex世代を明示し、migrationのdefault空文字を持つuserはPNG生成/配信をfail-closedにする。空文字を配信世代には使わない。将来cardDataに新たなevent由来入力を増やす時だけ、この集合と失効経路を同じPRで更新する。

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
| `GET /api/me/event-invites/:inviteId` | requireAuth＋本人所有 | pending期限内だけ200 {id,title,inviterName,expiresAt,status}。acceptedは{id,status,canOpenEvent}のみ（本体情報はdetail認可後に取得）。expired/declined/revokedは{id,status}のみ |
| `POST /api/me/event-invites/:inviteId/accept` | 空JSON | 200 {eventId,status:"accepted",canOpenEvent}。同じaccepted再送200、期限超過409 invite_expired、辞退/取消409 invite_unavailable |
| `POST /api/me/event-invites/:inviteId/decline` | 空JSON | 200 {ok:true}。同じdeclined再送200、acceptedは409（退出を案内） |
| `GET /api/me/event-access` | requireAuth、cursor?、limit既定20/最大50 | 200 {accesses:[{id,eventId,status:"accepted",createdAt,canOpenEvent,canLeave}],nextCursor}。privateの本人accepted全行を返す（draft/archivedを除外しない）。title/日時/場所/招待者/本文は一切含めない。canLeave=falseはmanagerのみ |
| `DELETE /api/events/:id/access` | {confirmCancelParticipation:true} | requireAuth＋本人accepted/revoked所有の限定例外（§4.1）。本体のcanViewEvent不要。200 {ok:true}だけ返す。acceptedを原子的に退出、revoked再送200。manager409 managed_access、行なし/別本人404 |
| 既存detail/join/date-votes/子API | 出力にevent.visibility/accessRevision、detailにcanView/canApply、myAccessStatusを追加 | roleやmembershipに閲覧権を混ぜない。canApplyはUI案内であって認可の根拠ではない |

一覧cursorは(created_at,id)の降順keyset。招待者/対象者のメール・外部identity・秘密鍵等は返さない。招待作成は既存pendingとの競合で409を返し通知二重送信しない。

`/event-invites` はログイン済み本人のpending欄に加え「承諾済みの閲覧権」欄を持つ。再ログイン後もナビ/ダッシュボードから到達でき、safe local redirectでここへ戻す。§3のcanViewEventがfalseの行は汎用「承諾済み・本体閲覧不可（募集開始待ち等）」と承諾日時/招待ID短縮表示・退出ボタンだけ（draftかarchivedかというevent状態も返さない）。canOpenEvent=trueだけ詳細APIからタイトル等を別取得してリンクを出す。本文不可のまま退出確認→DELETEが完了し、行を除去する。eventIdは本人の退出対象識別子であり本体への認可を与えない。

### 7.1 状態遷移

`none → pending → accepted / declined`、pendingは期限超過でexpired相当、pending/accepted/declined→revoked、expired/declined/revoked→新id pending。accepted→退出/撤回でrevoked。イベントがprivateでなくなれば行を全削除し旧id失効。manager資格はこの状態機械とは別。

- pending作成は参加/投票/Entryを増やさない。acceptedも同じ。参加は既存joinの別遷移。
- 撤回/退出の開催前処理: 既存leaveEvent相当（Entry/参加アンケートを処理し、confirmed participantはcanceled履歴、他の一般role/statusは既存ルールで削除）とgrant revokeを同じD1 batchで実行する。終了後は参加/回答履歴を変更せずgrantのみrevoke。
- manager本人退出/manager対象撤回は409 managed_access。staff降格/退出後は、acceptedが別にある場合のみprivateの閲覧が残る。staff招待の承諾だけで一般閲覧招待行は新設しない。
- grant失効者の過去投票は履歴として保持するが確定時の自動参加対象と通知対象から除外。自動登録結果はstaffへ reason=`access_revoked`/outcome=action_required として表示（元の投票者へ詳細通知しない）。再招待を承諾すれば次の通常申込で参加可能。

### 7.2 原子的判定と再試行

D1の既存batchパターンを使用（`S db/client.ts`）。任意のBEGIN/COMMITを別HTTP呼出しに分けない。新しい課金/汎用transaction基盤は作らない。

1. access_revisionはvisibility/status、招待状態、member作成/取消/role変更で増やす。private化確認が古いmember集合を使わないため、全member書込み（staff招待/抽選/自動参加含む）で同じbatch内に増分する。
2. visibility変更は期待revを条件に更新し、**その更新が成功したbatchだけ**member seed、参加者chat停止、開催前survey閉鎖/token回転、private離脱時の招待削除、§6.1の寄与user集合のプロフィールPNG世代回転を行う。更新数0なら全副作用をしない。
3. D1 batchの所有権は先頭の条件付きUPDATEの `RETURNING` と、後続SQLの `changes()` を専用ガードにするだけでは足りない（後続のchangesが変わる）。既存schedule finalizationのtoken方式に合わせ、§6の短命な `access_operation_token` 列（NULL許可）を使い、先頭UPDATEでランダムUUIDをセット、後続各SQLは一致EXISTS条件、最後に一致時のみNULLへ戻す。batch失敗は全ロールバック。この列はAPIに出さない。
4. 招待承諾はpending/期限/target user/招待者資格/privateを条件にUPDATE。statusと閲覧権が同じ行なので「承諾したが権限なし」は生じない。reissue/revokeと同時ならD1の先勝ち。revokeはacceptedにも作用するので承諾直後の撤回も最終的に失効する。
5. join・投票・参加アンケート・抽選・繰上げ・Entry作成は、書込みSQLのEXISTSで最新event/active user/private acceptedかmanagerを確認。HTTP middlewareの読取りだけを信じない。member結果からEntryを作る既存の分割箇所は同じbatchに寄せて、取消後の孤児Entryを防ぐ。
6. 日程確定は既存scheduleRegistrationの一括SQLに資格を追加。参加者選定時と通知SQLの両方で検査。既存受領再送は保存済結果を返し再参加/再通知しない。既存の定員順序（初回答日時、同時はuser ID）、抽選/複数枠/必須アンケート/取消履歴は維持。
7. 撤回と席解放は原子的。繰上げは既存waitlistの条件付きUPDATEを再実行可能にし、失効者は飛ばす。通知は状態が実際に遷移した場合だけ作る。処理中例外でrollbackしたら5xx、同じ入力を再送可。通信切断後も上記idempotent応答を返す。409は自動blind retryせずUIで再取得/再確認。
8. コミュニティ資格変更/退会は他表のためrevだけに依存しない。manager資格/active userも書込SQL内で再評価。read済responseや開始済streamまで撤回しない。

### 7.3 親event IDを持たないQR scan/undo（レビューP1-1修正）

`S worker.ts` の `/api/meet` はevent共通門外。現行 `R eventMeets.ts:meetablePairsBetween` は終了後2時間までpublished/双方confirmedから選ぶため、終了後のgrant撤回でconfirmed履歴を残す契約と組み合わせると漏れる。以下は新たなmember権限ではなく、既存操作に **双方のcanViewEvent** をANDする修正。

- `POST /api/meet/scan {token}` の署名/期限/self/used判定は維持。meetablePairsBetweenの選定SQLにscanner/targetのactive userと双方canViewEventを追加。診断 `diagnoseUnmeetable` のtiming/pending両SQLも同じ双方条件を追加し、失効eventをoutside_window/not_confirmed_target等の根拠に使わない。可視共通eventがない場合は既存409 `{error:"no_shared_event"}`のみ（eventの存在/失効を区別しない）、QRは消費しない。
- 選定後にも撤回があり得る。scanは既存のnonce確保を維持した上で、選定済event ID集合を入力にした**一回のD1 batch**で、双方最新資格/confirmed/日時窓を再評価して出会いINSERT、出席UPDATE、event_id付きアプリ通知INSERTを行う。各文が同一の適格集合をCTEで再評価する（batch内は他writerが割り込まない）。memberからの読取り済みroleを信用しない。出席を付ける一件も、この適格集合内で現行順序（開始済み最新、なければ開始直近）で選び直す。除外eventに代わり全件へ出席を付けない。
- 書込み結果はRETURNINGで得たevent ID/実際のmeet・attendance変更のみを持ち、未変更の既存meetを含む可視eventも同じbatchの最終SELECTから返す。各候補eventのINSERT用meet UUIDをbatch前に生成し、通知INSERTはそのUUIDで今回実際に作られたmeetへのEXISTSに限定する（既存meetとのON CONFLICTで通知を繰り返さない）。§6.1のPNG世代処理も同じbatch。DB例外は全書込みrollback、確保したnonceだけreleaseして5xx。書込みゼロも現行どおりreleaseする。途中で適格eventがゼロならno_shared_eventとしてevent/target詳細やundoTokenを返さない。
- 応答直前に結果eventへ双方canViewEventをもう一度SQLで適用し、見えなくなったeventのid/title/出席フラグをevents配列と**署名前のundoToken.grants**の両方から落とす。全件除外なら409 no_shared_event（実際の書込みがあればnonceは消費済みのまま）。結果SELECT後に成立した撤回以前の書込みを後から勝手に戻さない。送信開始後の応答copyを回収しない点は§5.2と同じ。
- notifyMeetの呼出しはeventIdを渡す形へ変更。新しいmeet通知はevent_idとactor_idを持ち、private本文は汎用。通知一覧は受信者だけでなくactorの現在閲覧資格も当該eventで確認、送信直前にも双方を確認する。§8の通常通知処理だけに任せ、scanの事前pairsからメールを送らない。外部送信との不可分性は§8の限界に従う。
- `POST /api/meet/undo {undoToken}` は既存署名/期限/scanner本人/記録されたgrant範囲を維持。各grantのscanner/target双方active・canViewEvent・confirmedを、削除と出席取消の**書込みSQL内**で確認する一回のbatch。開催後にgrantが撤回されたeventは履歴がconfirmedでも除外し、event_meet/出席を変えない。既存「そのscanが作ったmeetが実際に消えた場合だけ出席を戻す」とstaff条件を維持する。削除済meetへの再送はno-op。
- undoの通知削除は現行deleteMeetSince(target,actor,since)の横断削除を使わず、実際に取り消した **event_id集合 AND target AND actor AND 発行時刻以後** に限定し、同じbatchで行う。資格失効で除外したeventの通知/記録を一緒に消さない。応答直前にも双方の閲覧資格を再確認し、200 `{undone,attendanceRevoked}` はその時点で見えるeventの実変更分だけを集計する。全件除外/再送は `{undone:0,attendanceRevoked:false}`。失効eventの件数/ID/理由を返さない。
- 複数共通eventで一部失効しても全scanを無条件拒否せず、双方が見えるeventだけ処理する。DB書込み時に資格があった場合のみ先勝ち成立、その後撤回された場合の取得済応答や既存undoTokenのevent IDは回収不能だが、**以後の新規scan/undoが旧tokenを認可として使うことはない**。

## 8. 通知・公開の副作用

- 一般向けフォロワー作成/参加通知、たまご賛同者への公開通知はpublic/publishedのみ。claimFollowersNotifyにも条件を含める。private/unlisted→publicで初めてdiscoverableになる時は従来の初回一度だけ通知、再public化ではfollowers_notified_atを戻さない。
- 新規閲覧招待はevent_id付き **アプリ内のみ** の専用 `event_access_invite` 通知（招待一覧へ、本文は「閲覧への招待が届きました」の汎用文）。create/再発行と同じbatchで一度だけ保存し既存create()の自動メールを通さない。期限切れ/取消通知は画面上で汎用表示し名前を出さない。
- 新規event関連通知はevent_id必須。通知repoの一覧/未読数は現在の資格をSQLでfilterする。非public一般通知の受信者はmanager、有効memberかaccepted閲覧者に限る（業務対象の絞込みはさらに既存条件）。pending招待通知は本人受取資格で例外。既存staff招待もprivateでは汎用通知とし本人の招待一覧だけに最小情報を表示。
- 開催リマインダー/日程確定/一斉連絡は現行の対象者・設定を維持した上で最新資格を追加。`S lib/broadcast.ts` のキュー消化時にも再検査し失効分を送らず処理済/skipにする。privateメールは画像/会場/参加者一覧/詳細本文を載せず「イベントの更新があります」＋ログイン先URLのみ。主催者自由入力の一斉連絡本文もprivateメールには載せずアプリ内で読む。unlistedもフォロワー大量告知はしないが対象者業務メールは従来本文可。
- 送信直前判定と外部メール送信は単一DB transactionにできないため、その間の失効競合は残る。privateメールを汎用にすることで内容漏えいを小さくする。旧public時に送信/保存済みのメール・push通知・既に表示された通知は回収不可。
- 公開プロフィールのPNGアップロードはクライアント生成cacheである (`S routes/profileCardImages.ts`)。§5.3の世代分離/CASで通常の先行生成uploadと旧全組合せの再配信を拒否する。利用者が新snapshotの世代を指定しつつ意図的に古い画像内容を再アップロードすることまでは判別できない（画像内容の検証/再描画は本件外）。これと、何も再uploadしなくても旧組合せが復活するサーバーの穴は区別する。既に配信済みcopy/外部cacheの回収も別の限界。

## 9. 互換・導入・切戻し

1. DEFAULT publicで既存全イベントの公開範囲は維持。status、参加枠、回答、写真設定のdataは変換しない。unknown visibilityをpublicへ自動矯正しない。
2. 実装時はschemaと全読取り経路の認可対応を先に用意し、非public作成/更新入口は閉じて検証する。旧serverと非publicを扱うserverの混在期間を作らない。入口開放は別途配備承認後、cache旧TTL経過・全アクセス面gate成功後のみ。
3. migration番号の再確認/空DB・旧schema fixtureでの適用/foreign_key_checkは実装PRで行う。本設計PRでは実DBを照会しない。
4. PNG migrationでは旧世代を識別できない全既存組合せ/legacyを一度配信停止し、card_image_updated_atをNULLにする（card_image_keyの見た目選択は維持）。旧画像から新世代へコピー/フォールバックしない。以降の非public化は§6.1の当該event寄与userだけ失効し、無関係userは再生成不要。generation未指定の旧PNG PUTは400 generation_requiredで再読込を案内、旧GETの?k/legacy URLは§5.3に従い旧オブジェクトを読まない。
5. 旧clientはvisibilityを送らなければpublic作成、既存編集はvisibilityを維持。更新repoが全rowを書き戻す箇所 (`R events.ts`) は古いreadでvisibilityを上書きしないよう変更対象。非public処理に対応しない旧clientもserverの認可で拒否される。
6. 失敗時は入口を閉じる。**非publicを知らない旧serverへrollback禁止**（published扱いで漏れる）。認可対応済み版へforward fix/切戻し。必要ならイベントAPI/HTML/メディアを一時メンテナンス404にしてから復旧する。privateをpublicへ変換して復旧しない。
7. schemaの列/表はadditiveのまま保持し、down migrationで権限dataを捨てない。バックアップ復元にも公開範囲と招待状態が一組で必要。古いバックアップでrevokeが戻り得る場合は復旧前に非publicを閉じて運営確認する。
8. PNG世代を古いバックアップへ戻すと旧R2キーが復活し得るため、バックアップ復元時は画像配信入口を閉じ、復元対象userに新しい乱数世代を発行・更新時刻NULL化してから開く。R2残存旧世代を復元後の現行世代として参照しない。
9. migration/配備/本番操作はこの設計承認とは別承認。現在のユーザーcheckout・staging・productionを操作しない。

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
- server: §4のroute/SQL全系統、auth/eventAccess.ts、roles.ts、worker.ts/events.ts、eventAccessInvites route/repo、member/日程確定/通知/accountMerge/userTables、migration。P1修正対象は親門外のeventMeets scan/undoとnotifyMeet/deleteMeetSince、profileCardImages/userAvatars/users/PublicProfileの世代契約、§6.1の寄与関係書込み。1ファイル800行規約を守り認可をrouteへ複製しない。
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
| 親event IDなしのQR経路（P1-1） | private終了後にAを撤回（confirmed履歴を保持）、終了後2時間内にA→BとB→Aでscanしても409 no_shared_event、タイトル/id/undoToken/通知/meet/出席の新規変化なし。診断だけoutside_window等に漏れない。scan→A撤回→undoは失効event no-op。共通E1/E2のE1だけ失効ならscan/出席選択/undo/通知削除はE2のみ。SQL直前の撤回race、batch途中例外rollback、再送も確認 |
| PNGの旧組合せ復活（P1-2） | public時にA/Bとlegacyを用意→非public化→Aだけ新世代生成→旧gのA/B・未再生成B・legacy objectを参照する経路は404。gなしURLでも旧Bへfallbackしない。後でBを新世代生成しても旧g付きBは404。先行snapshot→visibility変更→旧g PUT、およびR2 put/CAS前後の変更raceは旧bodyを新世代へ置かない。If-None-Match/HEADも世代判定後に処理 |
| 局所PNG失効・過去関係（P1-2） | canceled member、memberでないspeaker、like target、meet両端それぞれのカードを生成→関係削除/担当差替えで旧世代404→非public化→別combo再生成でも復活なし。有効4人割れ/退会/統合とcommunity.myEventCountを確認。無関係userのgenerationとPNGは変わらない。移行前に既に関係消失した旧画像/legacyは導入時一度の隔離で全経路404 |
| 本体不可の本人退出（P1-3） | draftでaccepted未参加→ログアウト→再ログイン→event-invitesの本文なし管理行→退出200。publishedで承諾のみ→archived→同じ退出200。本体/他子APIは終始404のまま。GET等の別verb、別user/行なしは例外不可。revoked再送200、manager409、再取得で行が消える。公開範囲変更/削除との競合でも本文を返さない |
| 将来課金と認可の分離 | 課金未導入で決済依存なし。将来利用資格失効の仕様レビューで自動public化/閲覧者課金/取消禁止が入らない。初期無料をUIに未承認で表示しない |

認可の共通門・public SQL条件・join書込み時資格条件をそれぞれ隔離コピーで一箇所外し、対応するテストが落ちる変異証拠を実装レビューに添える。アプリ全テストが本設計PRの検証条件ではない。文書はdiff/link/source存在/行数/Markdown静的検証のみ、既存PR自動CIは許容。

## 12. 承認ゲートと未決定の区別

実装担当に選択を委ねないため、本書は単一の推奨案としてAPI/期限/権限/互換/競合を固定した。以下は**実装時判断ではなく、このDraftのユーザー最終承認項目**。異なる選択なら先に正本を更新して独立再レビューする。

1. 登録済みhandle→user.id招待、7日、受取/閲覧のみ承諾、未登録者は先に登録する最小UX。
2. unlisted/privateの参加者チャット停止（暗号化#205は後続）、独立公開スライド/配信素材は秘密資料として扱えない機能制限。
3. 既存memberのprivate化時閲覧維持、管理者/コミュニティ管理者の閲覧維持、取消と閲覧退出の分離、承諾済招待の撤回時の参加取消。
4. privateで開催前共有アンケート停止、会場提供者にも閲覧招待を要求、private業務メールは汎用文とする変更。
5. 将来有料化の事業意図と上記境界。将来の価格未定は認可の技術判断の穴ではないが、初期提供条件はリリース前に別途確定する。

上記の単一提案と独立レビュー済み設計に沿った実装は再開指示により着手可。初期提供条件はリリース前に別途確定する。配備・リモートmigration・実データ操作・mainマージは未承認。

## 13. 独立レビューへの設計修正記録

初版head `62502972e30b5202ad9ce84b99ae8e5860b6cb79` は独立レビューでP1三点によりblocked。以下はsource/契約の照合による再現条件であり、アプリを実行して再現したとの主張ではない。本修正もMarkdownのみ、実装/DB操作/配備なし。修正版の独立再レビューと§12のユーザー承認が済むまでblocked扱いを解除しない。

| 指摘 | 再現条件・不足 | 修正設計 / 受入への変更 |
| --- | --- | --- |
| P1-1 親eventパス外QRの撤回漏れ | 終了後撤回ではconfirmed履歴を残す一方、meetablePairsBetweenは終了2時間後まで履歴だけで選ぶ。scanはタイトル応答/meet/出席を書き、undoも同じ門を通らない | §4/§7.3で選定・診断・書込み・応答・署名前undoToken・通知に双方最新資格。複数共通eventの適格分だけ処理、undo通知も実削除eventで限定。§11.2に終了後撤回・途中撤回・一部失効の受入追加 |
| P1-2 PNG参照クリアだけでは旧Bが復活 | combo A/B保存→参照クリア→Aだけ再生成でuser共通updatedAtが復活し旧Bを配信できる。現行関係削除後の過去寄与userも現存関係だけでは拾えない | §5.3/§6/§6.1/§7.2/§8/§9でuser別世代・R2 namespace・snapshot/PUT CAS・現行世代GET、局所寄与集合と関係消失時の原子的回転、旧版全画像の導入時隔離。無関係userの毎回失効は不採用。§11.2に旧combo/legacy・先行生成race・過去寄与の受入追加 |
| P1-3 accepted本人がdraft/archivedから退出不能 | 本体閲覧不可なのでevent共通門に拒否され、declineもacceptedに409。本人一覧からも消えるため再ログイン後の入口なし | §1/§4.1/§7でDELETE本人accepted/revoked行だけ限定例外、本文を返さない本人管理一覧と再ログイン導線。一般canViewEventは変更しない。§11.2にdraft/archived退出・他verb/他user拒否の受入追加 |

将来有料化境界・§12のユーザー最終承認事項は初版から維持。レビュー修正はその承認や実装/配備の許可を代替しない。


## 14. 実装段階と現行sourceへの同期 (#526)

- 最初の保存単位はschema・共通閲覧境界・公開イベントrepositoryの発見条件。§9.2に従い、全アクセス面の実装・検証前は非public作成/visibility更新をAPIで409 `private_events_unavailable` として止める。これは初期提供条件/課金権限ではなく、未完成版を公開可能と誤認しないための一時的な実装閉鎖。UIの選択肢は全経路の保護とともに接続する。
- 現行roles.tsはcanceled行でもstaffと扱う。新境界では非canceledに揃え、app admin判定は現行のADMIN_DISCORD_IDSを使用する。manager資格とprivate accepted、draft/archivedのmember条件を同じSQL述語で判定する。SQL引数のuser IDはbind値とし、SQL式を渡す内部呼出しだけを許す。
- 共通門はworker.tsの画像・写真・ビーコンを含む最初のevent登録より前に置く。既存requireAuthを増やさない。実装基準のsession.tsには設計が前提にしたcurrentUserキャッシュが存在しなかったため、Context単位のPromiseキャッシュを同時に追加する（別リクエストとは共有しない）。Honoの `/events/:id/*` は直下 `/events/:id` も一致することを実routerで検証し、二重登録しない。門の内側に既存子権限が残る。本人退出例外は退出の原子的処理と同時に追加し、それ以前に抜け道を作らない。
- この段階だけでは§4全体、PNG世代の配信/更新、招待UX、書込み時再認可を満たさない。migration作成は機能完成/適用許可の意味ではない。未完成部分が残る候補はDraftのまま保持し、配備しない。

- 全体セキュリティヘッダの後処理が個別no-referrerを上書きしていたため、既に設定されたReferrer-Policyは維持する。private門の拒否を含む応答でno-referrerをテストする。

- ここまでの完了: additive schema、Eventのvisibility/accessRevision、共通SQL閲覧述語/イベントAPI門、eventsRepoの公開一覧/検索/件数、招待行統合の取消優先、public作成互換。招待受取API/UI・全member書込みのrevision/CAS・PNG世代配信/局所回転・間接経路・通知・チャット/クライアント再検証は未完了であり、非public入口を開けない。
- 検証: D1ローカルの実router全event verbの不許可404、private grant状態と子権限、公開一覧/feedの非public除外、FK/統合監査、空DB/旧schema移行fixtureを確認。共通門を隔離コピーで外すとawardsが200となり負例テストが失敗する。実ブラウザはローカル開発アカウントで既存作成画面→public下書き→詳細だけ確認。招待限定の利用者一巡や認証済staging受入は未実施。

- 最初の全体CIで、旧来の下書き/不存在401・403および画像max-ageを期待する既存テストが不一致になった。§3.3/§5.2の404/no-store契約へ対象テストだけを同期する。閲覧できるmemberの子権限不足403とstaffチャットの鍵世代更新検査は維持する。

### 14.1 閲覧招待ライフサイクルの実装単位

- 基盤70365bdの独立レビューは継続実装可、全体CIも成功。非public入口は引き続き閉鎖し、この単位はローカルfixtureだけで実HTTP招待・本人UI・通常参加との分離を検証する。
- handle確認後にhandleが他userへ移る競合への対策として、POSTの入力にoptional `expectedUserId` を追加する。UIは既存exactプロフィール取得の確認IDを必ず送信し、handle編集で確認を破棄する。サーバーはhandleを再解決したIDとの一致だけを検査し、不一致409 `handle_changed`では招待/revision/通知を一切変更しない。IDを招待先指定や認可として使わない。optionalは既存設計入力との互換であり、この確認保証はIDを送る確認フローに適用する。409時は相手が変わった旨を表示して再確認し、自動再送しない。
- 現行leaveEvent/promoteFromWaitlistは複数の独立書込みであり、閲覧権失効にはそのまま利用できない。grant失効と終了前のEntry/参加回答処理・membership取消/削除・条件付き先着繰上げを、access_operation_tokenで所有する単一D1 batchにする。終了条件は現行同様 `scheduling=0 AND ends_at<now`。終了後はgrantだけ変更して履歴を維持する。
- 招待通知は作成/再発行と同じbatch内の汎用アプリ通知だけ。既存通知createのメール副作用を通さない。残りのevent通知/PNG寄与集合/QR等は後続必須であり、この単位でも一般の非public作成を開けない。

- この保存単位では管理用招待API、本人受取/承諾/辞退、本文なしの承諾済み一覧、draft/archived本人退出、実際の `/event-invites` と主催者UIを接続した。既存exactプロフィール確認→ID一致検査→本人のHTTP承諾をローカルDB/実ブラウザで通し、承諾時の参加/Entryなし、別操作の参加→参加取消後も閲覧可→閲覧退出404、再発行/辞退、draft承諾/本文なし退出、別アカウントでの非表示を確認した。承諾済みgrantの直接投入は成功フローに使っていない。staging受入ではない。
- privateの通常joinは最新資格・状態・締切・枠定員を再確認する一つのbatchでmemberと個人Entryを作る。招待系とこのjoin、基本member追加/状態/role/取消、staff招待承諾、event status、日程確定にはrevision更新を入れた。accept/revoke、accept/reissue、最終席同時join、参加取消batch途中失敗rollbackの対象テストを追加した。
- なお§7.2全体は完了していない。既存の投票/参加アンケート/抽選/通常参加取消に伴う繰上げ/日程自動登録の最新資格SQL・Entry原子性、およびcommunity/account変化のrevision追随を次の保存単位で閉じる必要がある。上記の基本writer更新を「全writer対応」とは扱わない。PNG/QR/間接経路/通知/チャット、公開範囲変更とそのUIも未完了。機能全体の提供・merge・配備は引き続き不可。

### 14.2 継続レビュー後の書込み境界

- c4adb35の独立レビューは継続実装可・全体提供不可。具体的な修正は、重なる本人退出の同一招待revoked再読取による200と、内容を保持したQueryClientを再作成しないログアウト/切替テスト。以前のブラウザ切替確認は空の一覧でdocumentをreloadしており、メモリキャッシュ破棄の証明にはならない。
- sourceではglobal `refetchOnWindowFocus:false` が設定されている。招待・閲覧権とevent detailには明示的なfocus再検証が必要。これは全クライアント経路の対応を意味しない。
- 日程確定の既存batchは受領・member・Entry・通知を原子化しているが、投票者の最新閲覧資格も操作者の最新manager資格もSQLで確認していない。既存の初回答順/同時user ID順、再送受領を維持し、失効者は `access_revoked` として登録/通知から外す。投票/参加アンケートも現行のroute検査だけでは撤回後の書込みを防げないため、対象の書込みSQLに現在資格を追加する。revisionを増やすだけではこの問題は解決しない。
- この保存単位でも非public作成/visibility入口は開けない。抽選・通常繰上げ等の残るwriter、community/account変化とPNG/QR/間接経路/通知・チャット全体は、対応した実コードと未対応を区別して記録する。
- 通常の繰上げも現行はcandidate読取→member→Entry→通知の別書込みである。ここを定員・現在資格で所有権を取る一つのbatchに置換し、順序はcreated_at/rowidのまま維持する。前の参加者を取り消す呼出し元の処理まで原子化したと誤認しない。日程確定/この繰上げのメールだけは送信前のevent資格検査と非public汎用化を付ける。他のメール呼出しは後続対応のまま。
- community role/退出・eventのcommunity付替え、およびaccount統合/退会/復帰は現状access revisionを変更しない。関連event集合だけを同じbatchで増分する。全管理者は全eventに資格を持つため、そのaccountの資格変更だけは全eventが関連集合になる。これはPNG世代更新ではない。manager/active判定は引き続きwriter内SQLで再確認する。
- 実装/対象検証済み: 同一退出の制御付き競合と再発行409、populated QueryClientの破棄/既知のaccount切替/focus、投票と回答の撤回後書込み拒否、確定時のaccess_revoked・順序・再送、通常繰上げの競合/Entry失敗rollback、community/accountの関連event revision。ローカルの既存public日程登録・参加枠・メール・account/community回帰も対象検査した。全ローカルsuite/ブラウザ一巡は繰り返していない。
- この保存単位の残り: 抽選/手動参加状態/role変更とそのEntry副作用の最新資格・原子性、通常leaveのEntry/member/回答削除と席解放/繰上げの一体化、staff招待後の補助処理と直接Entry writerの監査。通常繰上げ単体のbatch化をこれらの完了とは扱わない。全体提供不可は維持する。

### 14.3 member/Entry書込みの継続

- 3c80f51の独立レビューはsubset継続可・全体提供不可。新規P2は通常繰上げがメール外部送信を直接awaitする変更。既存 `notificationsRepo.create` と同じ `deferBackground` に戻し、ExecutionContext内で外部fetchを停止させてもmember/Entry/通知を確定した操作が返る回帰テストを先に追加する。
- 現行抽選はJSでappliedをshuffleし、定員数を選んでからmember/Entry/通知を別々に更新する。手動当落も同様。対象と操作者の現在資格をbatch内で検査し、結果とEntryを一緒に確定する必要がある。JSのshuffle順を入力順として保持する。手動確定は従来どおり運営判断による定員超過を許す。既存confirmedがある追加抽選では空席だけを割り当てる（定員を増やした再抽選でも過剰割当しない）。
- 通常leave、role変更、staff招待承諾後の繰上げにはまだ独立した書込みが残る。staff暗号鍵のローテーション呼出しを変更・省略せず、member/Entry/回答/席/繰上げのDB境界を揃える。直接Entry/成果物、候補日/質問定義/一般event更新は対象call siteを個別監査し、実装済みと残存を分けて報告する。非public入口は引き続き閉鎖。
- 実call site監査で、通常public joinだけがmember→個人Entryの分割を使い、その他のcreateIndividual呼出しは抽選/手動当落に限られた。joinを同じ原子的writerへ統一し、canApplyのpublished/active/必須回答/枠をSQLで再確認する。直接成果物PUTはEntry所属だけを見ていたため、event所有と最新閲覧資格も保存SQLに追加する。
- 通常参加のDB一括化により、staff喪失時の既存onStaffLost呼出しは成功したDB変更の直後、メール配送前に維持する（以前の分割DB処理の途中ではなく一括変更後）。暗号SQLや鍵方式を別repoへ複製しない。
- 候補日定義、質問定義、一般event update/publish/deleteは現状routeのmanager検査だけ。actor IDを必須にしてwriterでも共有manager SQLを検査する。eventのcommunity付替えは付替え先の現資格も検査する。画像R2/他子APIまで対応したとは扱わない。
- この保存単位の検証: 遅延メールをwaitUntilへ逃がすP2再現、8件のmember書込みテスト（撤回済みtarget・降格actor、抽選順と既存席、抽選/手動Entry失敗rollback、通常取消+回答+繰上げrollback、staff招待acceptの繰上げrollback、終了後Entryへの不許可PUT、候補/質問/eventの降格後拒否）。既存publicの参加枠・staff招待・staff鍵ローテーション・日程・複製・R2回収等は対象テストで確認。隔離コピーで抽選actorのSQL門を外すと、降格したactorが当選を作り負例が失敗する。
- 今回の残存範囲: 新規event/copy時のcreator staff初期化は従来経路（非public作成は閉鎖）。staff招待の結果通知等はなお独立した通知経路であり、通知全体のevent_id/汎用化/再認可は後続。出席/check-in/QR、画像/R2と他の子リソースwriter、公開範囲遷移・PNG/間接経路・relay/全クライアントcacheまで完了したという意味ではない。一般event updateには読取revisionを条件にするが、visibility transitionの副作用プロトコルは未実装。

### 14.4 PNG/public profile隔離の実装単位

- e8f221dのreview指摘を先に修正する。managerによる除去は権限付与でないので、target閲覧資格を要求しない（actor現資格・snapshot・終了/最後のstaff保護は維持）。抽選メールは受信者ごとに独立してdeferする。
- 実sourceは旧combo/legacyキーをGETし、newuserのgeneration採番がない。公開profileは複数repo集計の後に世代を再確認していない。§5.3の新キー/PUT CAS/GET再確認へ移し、§6.1の寄与集合と公開集計を同時に実装する。migration0091の既存user隔離は既にあるが、これだけで安全とは扱わない。

#### §6.1実行方式の承認済み補足

2026-09-16の実装調整で、上記「同じD1 batch」の局所回転を限定列挙SQLite triggerで実行する方式を承認。アプリの任意SQLを解析する仕組みは作らない。eventの公開条件/日時/出席運用/community/作成者、event_member、event_schedule_itemと公開track関係、event_like（user対象）、event_meetのINSERT/UPDATE/DELETEを対象とし、OLD側BEFOREとNEW側AFTERで上記UNIONを回転する。userのdeleted_at変更/DELETEは関係が消える前にmembership/speaker/like送信者・対象/meet両端からeventを取得して回転。account mergeは既存の子行移動triggerで双方集合を捕捉し、勝者自身も同じbatchで新世代にする。FK CASCADEはBEFORE側で旧関係がある間に捕捉し、triggerの実行順に依存しない。世代列更新自体はtrigger対象列から除外し再帰させず、アプリの各writerへ重複する回転を追加しない。既存0091の全旧画像隔離は導入一回限り、以降は局所集合のみ。独立レビューと実D1のrollback/cascade検証前には配備不可。
- 追加source監査: nameCardsRepoは公開プロフィールの実績/community集計をbulkで複製していたため、同じpublic条件へ揃える（名札のevent参加者選定は変更しない）。公開communityの暗黙所属member一覧もcountと同じ条件へ。speaker_user_idとlike送信者user_idの局所参照には索引を追加する。
- この単位の検証: review P1/P2の実HTTP二段階除去・2受信者送信開始、workerd/D1で旧B/legacy非復活、PUT中/GET中/集計中の世代変更、寄与関係消失/置換・track公開条件・cascade/merge・rollback・失敗CAS・無関係user不変を確認。publicの実績/XP/受賞/登壇/写真facet/limit/community/たまごも負例と正例を検査。初期0091は旧schema fixtureで選択combo保持＋timestamp隔離を確認。D1のcompound SELECT上限に合わせuser自身は追加UNIONでなく外側OR条件にした。PNG列更新はtriggerを再発火しない。
- clientは表示snapshot変更で未完PNGを破棄し、409ではprofileを再取得してSVGから作り直す。(user,generation,combo)の送信管理と同世代の表示更新も回帰検査。元の描画関数はprofileCardPng.tsへそのまま分離した（汎用cache層は作らない）。ブラウザ実描画journey/staging検証を今回再実行したとは扱わない。
- なお配備不可。QRの双方認可、event HTML/slug/calendar、通知全体、participant relay/chat、全client cache/identity検知、creator/slot/attendance等の残るwriter、visibility遷移と開放UIが必要。trigger導入の独立review・配備時旧cache purge/TTL確認も必須。
