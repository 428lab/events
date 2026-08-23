# プロフィールをタブで分ける。メディアはページングとフィルタを付ける (#407)

- 対象: `apps/web`（`UserProfilePage` とその配下）、`apps/server`（写真一覧 API の
  ページング/フィルタ化と索引）、`packages/shared`（型・文言）
- 前提: #315（4分類＋年表）、#319（本人ページ=マイページ、他人には出さない）、
  #334（カードを主役に）はマージ済み。#360（`ParticipationTimeline.tsx` 800行超過）は未対応のまま残っている
- タブ構成と既定タブは issue #407 でユーザーが決定済み。**本書では変えない**

---

## 1. なぜ作るか

プロフィール画面は縦一列で、投稿した写真が全件（ページングなし）イベント一覧より
上に並ぶ。本人が関わるイベントを見るには写真を全部スクロールで通り過ぎる必要がある。

タブで分け、既定を「参加予定」にする。写真（メディア）はページングとフィルタを付け、
全件一括で取らないようにする。

## 2. タブ構成と各タブの母集団（決定事項の具体化）

タブは5つ（#407 で決定）。母集団は既存の4分類（`ParticipationHistory`）の分け方を
そのまま引き継ぎ、**タブに再配置する**。新しい分類軸は作らない。

| タブ | key | 母集団 | 出す相手 |
|---|---|---|---|
| 参加予定イベント（**既定**） | `upcoming` | 公開済み・これから（`scheduling` または `endsAt >= now`）。**主催ぶんも含む（#416）** | 全員 |
| 参加した過去イベント | `past` | 公開済み・過去。**主催ぶんも含む（#416）** | 全員 |
| 主催したイベント | `hosted` | 公開済み・`myRole === "staff"`（予定/過去の2セクションに分けて予定を先に） | 全員 |
| 下書きのイベント | `drafts` | `isDraftEvent()`（`status !== "published"`） | **本人のみ**（7. 参照） |
| 投稿したメディア | `media` | 本人が公開設定イベントに投稿した写真（既存ギャラリーの母集団） | 全員 |

- **時間軸（参加予定/過去）と役割軸（主催）は独立（#416）**。当初は
  「1イベントはちょうど1タブ」の排他（主催イベントは予定でも過去でも `hosted` のみ）
  だったが、本番フィードバック「自分の主催イベントも参加した過去のはず」を受けてやめた。
  主催イベントは `hosted` に出たまま、開催時期に応じて `upcoming` / `past` にも
  重ねて出る（件数バッジ・年表の母集団も同じ）。下書きだけは時間のタブに混ぜない
  （公開前のものが「参加予定」に出ると紛らわしい）
- 母集団のデータ源は現状と同じ: 他人のページは `GET /public/users/:handle`
  （SQL で `e.status = 'published'` に絞り済み）、本人のページは
  `GET /me/events`（下書き・申込中も含む自分用の一覧、#319）
- タブ見出しには件数を添える（例: 参加予定 (3)）。イベント系4タブの件数は
  読み込み済みの一覧から数える。メディアタブは開くまで取得しないので件数を添えない
  （添えるためだけに全員のページで写真 API を叩くのは本末転倒）
- `drafts` タブは本人かつ下書きが1件以上あるときだけ出す。`media` を含む他のタブは
  常に出し、空ならタブ内に空メッセージ（既存の `noOngoingEvents` / `noPublicEvents`
  に加え、タブごとの文言を足す）

## 3. ヘッダ部とタブの線引き

「その人が誰か」を示すものはタブの外（上）に残し、「その人が関わった物の一覧」を
タブの中に入れる。

**タブの外（現状の並びのまま）**:

1. プロフィールカード `ProfileCardPanel`（#334 の主役）
2. アクション行（フォロー/カード編集/QR/シェア/設定）
3. 登録日・フォロー数
4. 通算バー `TotalsBar`（母集団は従来どおり一覧全体。タブの絞りに追随させない —
   #315 の「通算」の意味を守る）
5. バッジ `BadgesSection`・参加実績 `ParticipationSection`・受賞 `AwardsSection`
6. コミュニティ（現状は写真の下にあるが、素性なのでヘッダ側へ上げる）

**タブの中**: イベント一覧（4タブ）と写真ギャラリー（メディアタブ）だけ。

受賞をタブの外に残す理由: 件数が少なく（入賞歴）、カード・バッジと同じ「実績＝素性」
だから。ここが将来長くなったら畳む（今回はやらない）。

## 4. 既存の4分類・年表との整理

### 4分類 → タブに解体

`ParticipationHistory` の4分類（これから主催/これから参加/主催した/参加した）＋
下書きセクションは、2. の5タブにちょうど写る（これから主催＋主催した → `hosted` の
2セクション）。よって **`ParticipationHistory` はタブ化と同時に役目を終える**。
中の `Section`（件数見出し＋`EventList`＋1列/2列切替）は新しいタブ側で使い回す。

### 年表 → タブ内の表示切替として残す

年表（#315）は「同じ母集団の別の見せ方」であって分類ではない。#310→#315 の経緯
（一覧が主役、年表は別枠・置き換えない）はタブ化後も変わらないので、**捨てずに、
イベント系3タブ（`upcoming`/`past`/`hosted`）の中の 一覧⇄年表 切替として畳む**。
既定は一覧（#315 と同じ）。切替状態はタブをまたいで共有し、URL には載せない
（現状の `ParticipationHistory` の list/timeline も state のみ）。

このとき **年表の中の絞り込み（役割: 主催/参加、時期: 予定/過去）は削除する**。
タブがその軸をすでに持っており、二重の分類になるため。`ParticipationTimeline` は
「渡されたイベント列を年表として描くだけ」の部品になり、`FilterChip`・
`roleFilterLabel`・`whenFilterLabel`・role/when の state と集計が落ちる
（ざっと 100 行強の削除。928 行 → 800 行前後）。**#360 と同じ方向で、この設計で
行数が増える変更はしない。** 800 行を切り切らなければ残りは #360 で続ける。

- `drafts` タブに年表切替は付けない（下書きに時系列の意味がない）
- 年表下部の「出会いの記録 N件」等の集計は、タブの母集団に対する値になる
  （通算はヘッダの `TotalsBar` が持つ。#315 の区別のまま）

**検討して捨てた案**:

- 年表を6つ目のタブにする — タブ構成は #407 でユーザーが決定済み。増やさない
- 年表を削除する — #315 でモックアップ合意まで経て作り直したもの。捨てるかどうかは
  ユーザーの定性判断であり、この設計の判断範囲外。必要なら別 issue で提案する

## 5. タブを URL に載せる

**載せる。** `?tab=past` の形のクエリパラメータ（`useSearchParams`）。

- 値は `upcoming` / `past` / `hosted` / `drafts` / `media`。**無指定＝`upcoming`**
  （既定タブはパラメータ無しの素の URL。既定を URL に書かない）
- 不正な値、および他人のページでの `drafts` は無指定と同じ扱い（既定タブに落とす。
  リダイレクトはしない）
- タブ切替は `setSearchParams(..., { replace: true })`。共有・リロードには残り、
  戻るボタンでタブ履歴を1つずつ遡らせない（戻る＝前のページ、が自然）
- 既存に「タブを URL に載せた」先例はない（イベント一覧 `EventsBrowser` はタブも
  フィルタも state のみ）。プロフィールは「この人の主催イベント一覧」を人に渡したい
  画面なので、タブだけ URL に載せる。**メディアのフィルタとページ番号は URL に
  載せない**（`EventsBrowser` のフィルタと同じ扱い。必要になったら後から足せる）

## 6. メディアタブ: ページングとフィルタの API

### 6.1 エンドポイント（既存を拡張。新設しない）

`GET /public/users/:handle/photos` に クエリパラメータを足す。公開範囲の条件
（`photos_public = 1`・`status = 'published'`・本人の投稿・`admin_hidden_at IS NULL`）
は**据え置きで全パラメータに常に AND** する（7. 参照）。

| param | 型 | 意味 |
|---|---|---|
| `page` | number, 既定1 | ページ番号 |
| `limit` | number, 既定24・最大50 | 1ページ枚数（`/events/search` と同じ上限） |
| `eventId` | string | イベント別フィルタ |
| `communityId` | string | コミュニティ別フィルタ（`e.community_id = ?`） |
| `commented` | `"1"` | コメントありのみ（`COMMENT_COUNT_EXPR > 0`） |
| `from` / `to` | number (ms) | 期間指定。**写真の投稿日時 `p.created_at`** に対して |

レスポンス（`/events/search` のページング契約に合わせる）:

```jsonc
{
  "photos": [ /* UserPhoto[] 既存の形のまま */ ],
  "total": 123, "page": 1, "limit": 24, "hasMore": true,
  // フィルタの選択肢。フィルタ適用前の母集団から出す（絞った結果で選択肢が痩せない）
  "facets": {
    "events": [{ "id": "...", "title": "...", "count": 12 }],
    "communities": [{ "id": "...", "name": "...", "count": 30 }]
  }
}
```

- 旧クライアント互換: `photos` キーは残るので、配備の谷間で旧 web が叩いても
  1ページ目が出るだけで壊れない
- `facets` は毎回返す（本人の写真に対する GROUP BY 2本。母集団は1ユーザー分で小さい）。
  別エンドポイントに分けると契約が2つになるのでやらない

### 6.2 ページングは「ページ番号」（無限スクロールにしない）

- 既存の作法が `page`/`limit`/`total`/`hasMore` ＋ MUI `Pagination`
  （`/events/search`・`EventsBrowser`）。`useInfiniteQuery` の前例はゼロ
- ページ番号なら末尾へ飛べ、DOM が際限なく伸びない。フィルタ変更時は 1 ページ目へ戻す

### 6.3 リポジトリ（N+1 にしない）

`eventPhotosRepo` に足す（既存 `listPublicByUser` は年表用と違い呼び元がここだけに
なるので、ページ版で**置き換える**）:

- `listPublicByUserPaged(userId, opts)` — 既存の SELECT に動的 AND と
  `LIMIT ? OFFSET ?` を足した**1本のクエリ**。コメント数は既存の `COMMENT_COUNT`
  （相関サブクエリ、`idx_photo_comment_photo` で1行ずつ引ける）のまま
- `countPublicByUserPaged(userId, opts)` — 同じ WHERE の COUNT 1本
  （`countSearchPublished` / `searchPublished` の対と同じ形）
- `photoFacetsForUser(userId)` — 同じ基本 WHERE で `GROUP BY e.id` と
  `GROUP BY e.community_id` の2本。イベント名・コミュニティ名は JOIN で同時に取る
  （後から名前を1件ずつ引かない）

### 6.4 索引

`event_photo` の索引は `(event_id, created_at)` だけで、**`user_id` の索引が無い**。
既存の `listPublicByUser` も実は全走査しており、ページング化で毎ページ叩くように
なるので、ここで足す:

```sql
-- 0xxx_event_photo_user_index.sql
CREATE INDEX idx_event_photo_user ON event_photo(user_id, created_at);
```

コミュニティ別・イベント別・期間は、この索引で本人の写真に絞った後の
JOIN・フィルタで足りる（1ユーザーの写真数は高々数百のオーダー）。追加の索引は不要。

### 6.5 フィルタ UI

`EventsBrowser` の作法に合わせる: イベント/コミュニティは `Select`（選択肢は
`facets` から）、コメントありのみはトグルチップ、期間は from/to の date input。
すべてコンポーネント state（5. のとおり URL に載せない）。変更時に `page` を 1 へ。

hook は `useUserPhotos(handle)` を `useUserPhotos(handle, params)` に拡張し、
queryKey にパラメータ文字列を含める（`useEventSearch` と同じ形）。取得はメディア
タブを初めて開いたときから（`enabled: tab === "media"` 相当）。**現状の
「プロフィールを開いた瞬間に全写真を取る」は無くなる。**

## 7. 下書き・非公開が漏れない保証（最重要リスク）

画面の出し分けには頼らない。**他人に届くデータ経路のすべてが SQL の段階で
公開済みに絞られている**ことを保証の根拠にする。

### 7.1 経路の棚卸し

| 経路 | 絞り | 確認 |
|---|---|---|
| `GET /public/users/:handle`（イベント一覧） | `eventMembersRepo.listPublicEventsForUser`: `e.status = 'published'` を WHERE に持つ | 既存・据え置き |
| `GET /public/users/:handle/photos` | `photos_public = 1 AND e.status = 'published' AND admin_hidden_at IS NULL` | 既存・**新パラメータは常に AND**（緩める方向のパラメータは無い） |
| `GET /me/events`（下書きを含む唯一の経路） | セッションの本人の一覧しか返せない（`:userId` を受け取らない） | 既存・据え置き |

新設 API は無い。下書きタブのデータ源は `GET /me/events` だけで、これは他人の分を
**要求する口が構文上存在しない**。

### 7.2 フィルタで公開範囲が緩まないこと

- `eventId` に**下書きイベントの id を直接指定しても**、基本 WHERE
  （`status='published'` 等）が AND で残るので 0 件になる。「指定 id を優先して
  公開条件を飛ばす」ような分岐は書かない
- `facets` も同じ基本 WHERE から出す（下書きイベント名が選択肢に漏れない）

### 7.3 テストで固定する

新設 `apps/server/test/profile-photos-paging.test.ts`:

1. 下書きイベント（本人参加・写真あり）が、他人視点の
   `/public/users/:handle/photos` に**どのフィルタ組合せでも**出ない。
   特に `eventId=<下書きの id>` を明示指定して 0 件・facets にも不在を確認
2. `photos_public = 0` のイベント、`admin_hidden_at` 付き写真も同様に不在
3. ページング境界（`total`・`hasMore`・最終ページ・`limit` 上限クランプ）
4. フィルタの正: イベント別/コミュニティ別/コメントありのみ/期間で件数が合う

web 側は `ProfileTabs` のテストで「他人のページに drafts タブが描画されない」
「`?tab=drafts` を他人のページで開いても既定タブに落ちる」を固定する
（`ParticipationHistory.test.tsx` の移し替え先）。

## 8. 文言（i18n）

`packages/shared/src/i18n/messages/profile.ts` に ja/en 両方を足す（既存の流儀:
同ファイル内の ja ブロックと en ブロック）。

- タブ名: `tabUpcoming` 参加予定 / `tabPast` 参加した過去イベント /
  `tabHosted` 主催したイベント / `tabDrafts` 下書き / `tabMedia` 投稿したメディア
- タブ内の空表示: `tabEmptyUpcoming` / `tabEmptyPast` / `tabEmptyHosted` / `tabEmptyMedia`
- メディアフィルタ: `mediaFilterEvent` / `mediaFilterCommunity` /
  `mediaFilterCommented` / `mediaFilterFrom` / `mediaFilterTo` / `mediaFilterClear`
- 既存の `tabList` / `tabTimeline`（一覧⇄年表）、`sectionDrafts` / `sectionDraftsNote`
  （下書きタブの注記に転用）、`sectionHosting` / `sectionHosted`（hosted タブ内の
  2セクション見出し）は使い回す。UI 文言に実装技術名は出さない（既存方針）

## 9. ファイル構成と行数

| ファイル | 変更 | 見込み |
|---|---|---|
| `apps/web/src/pages/UserProfilePage.tsx` | ギャラリー（約120行）を分離、`ParticipationHistory` 呼び出しを `ProfileTabs` に差し替え | 647 → 約500行 |
| `apps/web/src/components/profile/ProfileTabs.tsx` | **新設**。タブバー＋URL同期＋イベント系4タブ（`Section` を `ParticipationHistory` から引き継ぐ）＋一覧⇄年表切替 | 約250行 |
| `apps/web/src/components/profile/ProfileMediaTab.tsx` | **新設**。グリッド＋ライトボックス（移設）＋フィルタ＋Pagination | 約300行 |
| `apps/web/src/components/ParticipationHistory.tsx` | **削除**（`ProfileTabs` に吸収） | −137行 |
| `apps/web/src/components/ParticipationTimeline.tsx` | role/when 絞り込みの削除のみ | 928 → 約800行 |
| `apps/web/src/api/eventPhotoHooks.ts` | `useUserPhotos` にパラメータ | +30行程度 |
| `apps/server/src/routes/public.ts` | photos ルートにクエリ解釈（`/events/search` と同型） | +30行程度 |
| `apps/server/src/db/repositories/eventPhotos.ts` | ページ版・COUNT・facets。`listPublicByUser` は置き換え | +80行程度 |
| `apps/server/migrations/0xxx_event_photo_user_index.sql` | **新設**。6.4 の索引 | 数行 |

どのファイルも 800 行を超えない。

## 10. PR の分割（推奨: 2 PR）

**PR1: タブ化（web のみ）** — issue の「タブで分けたい」を先に届ける

- `ProfileTabs` 新設・`?tab=` URL 同期・drafts の出し分け・
  `ParticipationHistory` 吸収・`ParticipationTimeline` の絞り込み削除・文言
- メディアタブの中身は**既存のギャラリーをそのまま移設**（全件取得のまま。
  ただし取得開始はタブを開いたときに変わるので、既定タブの表示は既に軽くなる）
- サーバ変更なし。web のテスト移し替えのみ

**PR2: メディアのページングとフィルタ（server＋web）**

- API 拡張・リポジトリ・索引マイグレーション・`profile-photos-paging.test.ts`・
  `ProfileMediaTab` のフィルタ/Pagination UI

理由: PR1 は UI の組み替えで差分が広く、PR2 はマイグレーションと漏えいテストを
背負う。混ぜるとレビューで「タブの見た目」と「SQL の公開範囲」を同時に見ることに
なり、どちらも浅くなる。PR1 単独でも利用者価値があり、PR2 が遅れても壊れない。

## 11. 対象外（この issue でやらない）

- 動画対応（別 issue。メディアタブは器として動画が増えても収まる命名・構造にする）
- `ParticipationTimeline` の残りの責務整理（#360。ここでは増やさない、が約束）
- メディアフィルタ・ページ番号の URL 化（必要になったら追加）
- 年表を捨てる判断（ユーザーの定性判断。必要なら別 issue で提案）
