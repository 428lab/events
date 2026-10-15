# イベントの共催コミュニティ (#625)

- Issue: https://github.com/428lab/events/issues/625
- migration: `apps/server/migrations/0112_event_cohost.sql`

## 1. 方針

- 主催は今の `event.community_id` のまま（1つ）。共催は新しい表 `event_cohost` に持つ。
- **共催コミュニティには権限を渡さない。** 共催が効くのは次の2つだけ。
  - イベント詳細に共催コミュニティを表示する
  - 共催側のコミュニティページのイベント一覧に「共催」ラベル付きで載せる
- 共催側の人に運営してほしいときは、既存の「運営スタッフ招待」(#339) で個別にスタッフにする。
  権限は人単位で明示的に渡す。
- 共催の成立には共催先コミュニティの owner/admin の承認が必須。#264 と同じく、
  他のコミュニティに無断でぶら下げないため。
  - ただし依頼者自身が共催先の owner/admin なら、承諾できる本人が頼んでいるので承認を挟まず
    すぐ共催中にする（自分が管理するコミュニティ同士の共催を一操作で済ませるため）。

## 2. 表

`event_cohost`

| 列 | 内容 |
| --- | --- |
| `event_id` | イベント（`ON DELETE CASCADE`） |
| `community_id` | 共催先コミュニティ（`ON DELETE CASCADE`） |
| `status` | `pending`（承認待ち）/ `accepted`（共催中） |
| `created_at` | 申請日時 |
| `responded_at` | 承認日時（承認待ちは NULL） |

- 主キーは `(event_id, community_id)`。索引 `idx_event_cohost_community(community_id, status)`。
- 辞退・取り下げ・共催をやめるはどれも行を消す。`declined` の状態は持たない。
- **user を参照する列は持たない。** 依頼者は記録せず、結果の通知はイベントの作成者
  （`event.created_by`）に送る。アカウント統合・退会の列の棚卸し（userTables / accountMerge）の
  対象を増やさないため。

## 3. 振る舞い

| 操作 | できる人 | 結果 |
| --- | --- | --- |
| 申請 | イベントの管理者（イベント編集と同じ判定 `requireEventRole(["staff"])`） | 承認待ちの行を作り、共催先の owner/admin 全員に通知 |
| 申請（依頼者が共催先の owner/admin） | 同上かつ共催先の owner/admin（承諾と同じ判定 `communitiesRepo.isManager`） | 共催中の行を作る（`responded_at` も入れる）。依頼・結果の通知は送らない |
| 取り下げ | イベントの管理者 | 承認待ち・共催中どちらも行を消す。通知なし |
| 承諾 | 共催先の owner/admin | 承認待ち → 共催中。イベントの作成者に通知（承諾） |
| 辞退 | 共催先の owner/admin | 承認待ちの行を消す。イベントの作成者に通知（辞退） |
| 共催をやめる | 共催先の owner/admin | 共催中の行を消す。通知なし |

- 主催コミュニティそのものは共催にできない。
- 共催数の上限は承認待ちを含めて 5（`MAX_EVENT_COHOSTS`）。
- 表示順は主催 → 共催（承認順）。承認待ちは運営向けの一覧でだけ、その後ろに申請順で並ぶ。
- 主催コミュニティを付け替えたとき、新しい主催が共催にいたらその共催の行を同じ batch で消す。
- 複製では共催を引き継がない（相手の承認がもう一度要るため）。
- コミュニティ・イベントを削除すると行は FK CASCADE で消える。

## 4. API

### 主催側（`apps/server/src/routes/eventCohosts.ts`）

| メソッド・パス | 内容 |
| --- | --- |
| `GET /api/events/:id/cohosts` | 共催の一覧（承認待ちを含む）。管理者のみ |
| `POST /api/events/:id/cohosts` | body `{ slug }`。URL（`https://…/c/<slug>/`）や `/c/<slug>` も受け付ける。201 で `{ status, cohosts }`。`status` は作った行の状態（依頼者が共催先の owner/admin なら `accepted`、それ以外は `pending`） |
| `DELETE /api/events/:id/cohosts/:communityId` | 取り下げ |

申請のエラー

| 状況 | 応答 |
| --- | --- |
| コミュニティが無い | 404 `community_not_found` |
| 主催コミュニティと同じ | 400 `host_community` |
| 既に承認待ち・共催中 | 409 `already_cohost` |
| 上限（5）に達している | 400 `cohost_limit` |

依頼者が共催先の owner/admin でも、上の検査（主催と同じ・既にある・上限）は同じく効く。
上限は承認待ちの行も数える。

### 共催側（`apps/server/src/routes/communities.ts`）

いずれもそのコミュニティの owner/admin のみ（`communitiesRepo.isManager`）。

| メソッド・パス | 内容 |
| --- | --- |
| `GET /api/communities/:id/cohosts` | 依頼中・共催中の一覧（イベント名・日時・公開範囲・主催コミュニティ名）。閲覧者がそのイベントを閲覧できない（`eventViewSql`）行は、イベント名・日時・主催コミュニティ名を null で返す |
| `POST /api/communities/:id/cohosts/:eventId/accept` | 承諾 |
| `DELETE /api/communities/:id/cohosts/:eventId` | 辞退（承認待ち）/ 共催をやめる（共催中） |

### 公開側

- `GET /api/events/:id` の応答に `cohosts`（共催中のみ。主催の `community` と同じ形の配列）。
- コミュニティページの一覧（`/api/public/communities/:slug` と `/api/public/communities/:slug/events`）は、
  主催のイベントに加えて共催中のイベントも返す。公開範囲の条件は主催のときと同じ
  （限定公開・非公開は閲覧資格のある人にだけ出る。共催先の owner/admin だからといって出ない）。
  - 条件は `events.ts` の `buildSearchWhere` の `communityId` にあるので、一般検索の `communityId`
    絞り込み・フィードにも共催中のイベントが含まれる。
  - コミュニティの開催数（`eventCount`）は共催を数えない（`hostedOnly`）。

## 5. 通知

| 種類 | 宛先 | eventId | リンク |
| --- | --- | --- | --- |
| `cohost_request` | 共催先の owner/admin 全員 | 付けない | `/c/<slug>/edit#cohosts` |
| `cohost_result` | イベントの作成者 | 付ける | `/events/<id>/manage#cohosts` |

- `cohost_request` に eventId を付けないのは、受け手（共催先の owner/admin）がそのイベントを
  閲覧できないことが多く（下書き・限定公開・非公開）、eventId を付けると `notificationVisibleSql` の
  閲覧資格の判定で通知ごと消えるため。本文にはイベント名と主催コミュニティ名（主催が無ければ依頼者の
  表示名）が出る。actor は付けない。
  - ただし非公開・下書きのイベントは、eventId が無く汎用化（`genericEventNotice`）が効かないので、
    題名を含まない汎用の文面（`genericEventNotice` と同じ文言）で送る（`docs/private-events.md` §8）。
  - メールは送らない（`skipEmail`）。取り下げ→再依頼のたびに owner/admin 全員へ再送されるため。
- 依頼者が共催先の owner/admin で、すぐ共催中になったときは `cohost_request` も `cohost_result` も送らない
  （依頼した本人が承諾したのと同じで、知らせる相手がいないため。共催先のほかの owner/admin にも送らない）。
- `cohost_result` は通常のイベント通知と同じ扱い（特別扱いを足していない）。作成者がイベントを
  見られなくなっていれば届かない。承諾と辞退で文言が分かれる。共催をやめた・取り下げたときは送らない。

## 6. 触らないもの

共催はここに一切効かせない。

- 権限・閲覧資格: `eventManagerSql` / `eventViewSql`（`apps/server/src/auth/eventAccess.ts`）、
  `access_revision`、プロフィールカードの失効トリガ
- 集計: KPI（`communityKpi.ts`）、トレンド、`event_count`、`member_count`、名札・プロフィールの所属
- コミュニティへの「いいね」（`eventLikes`）、AI API の読み取り出力（後日）

## 7. 画面

- イベント詳細: 主催の後ろに共催を同じ見た目（アイコン＋名前リンク `/c/<slug>`）で並べ、「共催」と添える。
- 運営ページ（その場で管理）: 「共催コミュニティ」（`#cohosts`）。一覧（承認待ち / 共催中、外す）と、
  コミュニティを選んで追加する検索欄（`EventCohostsCard`、MUI Autocomplete）。上限に達したら追加を無効化して理由を表示。
  - 候補は、自分が owner/admin のコミュニティ（`GET /api/communities/mine`）を先頭に「すぐ共催」の印で、
    続けてほかのコミュニティ（公開一覧 `GET /api/public/communities`）を「承認待ちで依頼」の印で並べる。
    各行にアイコン・名前・`/c/<slug>`。主催コミュニティと、承認待ち・共催中のコミュニティは出さない。
  - 名前・slug の部分一致で絞り込む。URL（`https://…/c/<slug>/`）を貼ると slug に直して一致させる。
  - 一覧に無いものは、検索欄に URL か slug を入れて Enter で送る（予備の手段。サーバーが slug に直す）。
  - 追加後は応答の `status` で「共催に追加しました」/「共催を依頼しました。承認されると共催になります」を出し分ける。
    すぐ共催中になったときは詳細とコミュニティページの一覧も取り直させる。
- コミュニティ編集ページ: 「共催」（`#cohosts`）。依頼中（承諾 / 辞退）と共催中（共催をやめる）。
  各行に下書き・公開範囲（招待限定 / 限定公開）のチップ。閲覧できないイベントは題名の代わりに
  「非公開のイベント」と出し、日時・主催は出さない（操作はそのまま使える）。
- コミュニティページのイベント一覧: 主催でないカードに「共催」チップ。
