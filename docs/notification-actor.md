# 通知の actor を列として持つ (#380)

- 対象: `apps/server`（D1 スキーマ・通知リポジトリ・通知を作る側）
- 前提: i18n 第3段階（通知を種別＋値に作り直す）の**着手前**に入れること
- ステータス: 設計（実装は別 PR）

---

## 1. なぜ直すか

退会 (#250) したとき、その人が「した側」として生まれた通知を他の利用者の一覧から
消している。いまその判定は3通りに分かれている。

| 種別 | いまの判定 |
|------|-----------|
| `meet` | `link = '/users/{本人のusername}'` |
| `followee_created_event` | `link IN (SELECT '/events/'||id FROM event WHERE created_by = ?)` |
| `followee_joined_event` | `title LIKE '{表示名} さんが%'` **かつ** `link IN (本人が参加中のイベント)` |

問題は2つある。

1. **`followee_joined_event` が通知タイトルの日本語の綴りに依存している。**
   i18n 第3段階で通知を「種別＋値」に作り直すと `LIKE` が一致しなくなり、
   退会した人の名前がフォロワーの通知一覧に残り続ける。退会の目的
   （他の利用者から見えなくなる）が果たされない。
2. **同じ契約が3か所に散っている。** 「この通知の主語は誰か」という一つの問いに、
   種別ごとに違う近似で答えている。近似なので、どれも取りこぼす（後述 2.）。

第3段階に着手してから気づくと、通知の作り直しと退会処理の作り直しが同時に走る。
先に土台を直す。

---

## 2. いま何が取りこぼされているか（調査結果）

設計の前に、現行実装が「正しく動いているわけではない」ことを確認した。

- **ハンドル (`username`) は変更できる**（`PUT /api/me/username`）。
  `meet` の判定は「**現在の** username で組み立てたプロフィールURL」との一致なので、
  出会いのあと改名した人の meet 通知は**いまも消えていない**。
- **表示名 (`global_name`) も変更できる**（`PUT /api/me/display-name`）。
  `followee_joined_event` の `title LIKE` は「**現在の** 表示名」で照合するので、
  参加通知のあと表示名を変えた人の通知も**いまも消えていない**。
- `username` はスペースを含められる（`USERNAME_PATTERN`）。
  さらに OAuth 由来の初期 username にサニタイズが無いため、
  `encodeURIComponent(username)` が生の username と一致しない行が存在しうる。
- `followee_joined_event` の `title LIKE '{名前} さんが%'` は、
  **同じイベントに同じ表示名の別人が参加していると、その人の通知まで消す**。

つまり現行は「言語に依存している」だけでなく「名前の現在値に依存している」。
actor を列として持てば、どちらも同時に無くなる。

さらに、**契約が散っている箇所は3つではなく4つ**ある。

- `deleteMeetSince`（#330 出会いの取り消し）も
  `link = '/users/{username}'` を「actor は誰か」の代用に使っている。

---

## 3. 決めたこと（結論）

1. `notification` に `actor_id` を足す。意味は **「その通知の主語になっている利用者」**。
   主語が人でない通知（運営宛の検知、一斉連絡、当落通知など）は **NULL**。
   NULL は「未設定」ではなく「主語が人ではない」という積極的な意味を持たせる。
2. `deleteByActor` は **`actor_id = ?` の1文**にする。`link` も `title` も使わない。
3. **「埋める」と「消す」を分離する。** actor_id は「通知の文面に名前が出る」通知すべてに
   埋める（現時点で5か所）。一方、退会時に消すのは従来どおり3種別だけで、
   その一覧を共有定数 `ACTOR_ERASED_TYPES` として1か所に置く。
   こうしておくと、埋める範囲を広げたときに削除範囲が黙って広がらない。
4. 既存行は**埋め戻す**。埋め戻しに使う「タイトルの綴り」への依存は、
   **一度きりのマイグレーションの中に閉じ込める**。恒久的な契約からは消える。
5. `deleteMeetSince` も `actor_id` に寄せる（4か所目の契約を残さない）。

---

## 4. マイグレーション

### 4.1 `apps/server/migrations/0070_notification_actor.sql`

```sql
-- 通知の「主語になっている利用者」を列として持つ (#380)。
--
-- 退会 (#250) したとき、その人が「した側」として生まれた通知を他の利用者の一覧から
-- 消している。これまでは notification に actor 列が無く、種別ごとに違う近似
-- （meet は link、followee_created_event は link からの副問い合わせ、
--   followee_joined_event は title の日本語 + link）で actor を特定していた。
--
-- 近似なので3通りとも取りこぼす:
--   - username は変更できる → 改名した人の meet 通知が消えない
--   - global_name も変更できる → 改名した人の参加通知が消えない
--   - title LIKE は同姓同名の別人の通知まで消す
-- そして title 依存は、i18n 第3段階（通知を種別＋値に作り直す）で必ず壊れる。
-- 壊れると「退会したのに名前がフォロワーの一覧に残る」＝退会の目的が果たされない。
--
-- actor_id を持てば、判定は actor_id = ? の1文になり、上の3つが同時に直る。
-- あわせて第3段階で必要になる「値」の1つ目でもある（"{actor} さんが…" の actor）。
--
-- NULL の意味: 「主語が人ではない」。運営宛の検知 (abuse_flag)、スタッフからの
-- 一斉連絡 (event_broadcast)、当落・受賞・アンケートなど、受信者本人のことを
-- 知らせる通知はすべて NULL のままにする。deleteByActor は NULL の行に触れない。
--
-- ON DELETE SET NULL: 完全削除 (#244) でユーザー行が消えたあとに、存在しない id を
-- 指す行を残さないため。venue_photo.user_id (0032) と同じ形。
ALTER TABLE notification ADD COLUMN actor_id TEXT REFERENCES user(id) ON DELETE SET NULL;

-- 退会時の削除 (deleteByActor) が全表走査にならないようにする。
-- 大多数の行は actor_id が NULL なので、user.deleted_at (0054) と同じく
-- 部分インデックスにして小さく保つ。
CREATE INDEX idx_notification_actor ON notification(actor_id) WHERE actor_id IS NOT NULL;

-- ============================================================
-- 既存行の埋め戻し
--
-- 埋め戻さないと「新しい行は actor_id、古い行は link/title」の2契約が残り、
-- 直す意味が薄れる。埋め戻す。
--
-- ここで followee_joined_event だけは title の綴りに頼る。恒久的な契約としては
-- それを無くすのが本 PR の目的だが、**この UPDATE は一度しか実行されない**。
-- 実行時点の文言は現行の文言なので照合できる。移行が終われば title への依存は
-- どこにも残らない。ただしそれゆえ、
--   **このマイグレーションは i18n 第3段階より先に本番へ流すこと。**
-- 逆順になると埋め戻しが空振りする。
--
-- 3本とも `WHERE ... AND actor_id IS NULL` を付けて冪等にしてある。
-- 「マイグレーション適用 → デプロイ」の窓の間に旧コードが書いた行を潰すため、
-- デプロイ完了後に同じ3本をもう一度流す（8. の手順）。
-- ============================================================

-- (1) meet: link が actor 本人のプロフィールURL。
--     event_meet の存在で裏を取る。username は変更できるため、
--     「A が手放したハンドルを B が取った」ケースで B に誤って結び付くのを防ぐ。
UPDATE notification SET actor_id = (
    SELECT u.id FROM user u
     WHERE notification.link = '/users/' || REPLACE(u.username, ' ', '%20')
       AND EXISTS (
         SELECT 1 FROM event_meet em
          WHERE em.user_low  = min(u.id, notification.user_id)
            AND em.user_high = max(u.id, notification.user_id))
  )
 WHERE type = 'meet' AND actor_id IS NULL;

-- (2) followee_created_event: link 先のイベントの作成者。
--     完全削除で ghost に付け替わったイベントは除く。
--     ghost を actor にすると、以後 ghost 名義の一括削除が効きうる。
UPDATE notification SET actor_id = (
    SELECT e.created_by FROM event e
     WHERE notification.link = '/events/' || e.id
       AND e.created_by != (SELECT id FROM user WHERE discord_id = 'system:deleted-user')
  )
 WHERE type = 'followee_created_event' AND actor_id IS NULL;

-- (3) followee_joined_event: link 先のイベントの参加者のうち、
--     タイトルが現行の文言と一致する1人。
--     COALESCE(global_name, username) はコード側の `globalName ?? username` と同じ意味。
--
--     **1人に定まるときだけ埋める。** 同じイベントに同じ表示名の人が2人居ると
--     どちらか分からない。いまの LIKE 条件はこの場合に両方消してしまっており、
--     それ自体が「別のフォロイーの通知を巻き込まない」という約束の破れだった。
--     埋まらなかった行は退会時に消えない。誤って他人の通知を消すより良いと判断した。
UPDATE notification SET actor_id = (
    SELECT m.user_id FROM event_member m JOIN user u ON u.id = m.user_id
     WHERE notification.link = '/events/' || m.event_id
       AND notification.title = COALESCE(u.global_name, u.username)
                                || ' さんがイベントに参加しました'
  )
 WHERE type = 'followee_joined_event' AND actor_id IS NULL
   AND (SELECT COUNT(1) FROM event_member m2 JOIN user u2 ON u2.id = m2.user_id
         WHERE notification.link = '/events/' || m2.event_id
           AND notification.title = COALESCE(u2.global_name, u2.username)
                                    || ' さんがイベントに参加しました') = 1;
```

### 4.2 埋め戻せない行

以下は埋まらない。**そのぶんは退会時に消えない**（＝現状維持であって、悪化はしない）。
現行実装も同じ行を消せていないため、この移行で消える通知が増えることはあっても減らない。

| 埋まらない行 | 理由 | いまの挙動 |
|---|---|---|
| 出会い・参加のあとに改名した人の通知 | link / title が現在値と一致しない | いまも消えていない |
| 同じイベントに同姓同名が居る参加通知 | 1人に定まらない | いまは**両方**消えている（過剰削除） |
| 作成者が既に完全削除されたイベントの公開通知 | created_by が ghost | いまも消えていない |
| username に `[A-Za-z0-9_.-]` と空白以外を含む人の meet 通知 | URLエンコードと一致しない | いまも消えていない |

---

## 5. 通知を作る側

### 5.1 リポジトリの API

`create` / `createForMany` に **オプション引数で** actor を渡す。位置引数は既に
6つあるので、7つ目を足さない。

```ts
create(userId, type, title, body?, link?, extras?, opts?: { actorId?: string })
createForMany(userIds, type, title, body?, link?, extras?,
              opts?: { skipEmail?: boolean; actorId?: string })
```

`createForMany` は既に `opts` を持っているので、そこに1つ足すだけ。
INSERT の列に `actor_id` を足し、値は `opts?.actorId ?? null`。
**21 か所は無変更**で済む。

### 5.2 26 か所の呼び出し元と actor の有無

「その通知の文面に**他人の名前が出るか**」で決める。出るものだけ埋める。
i18n 第3段階で `"{actor} さんが…"` の値として要るのも、ちょうどこの集合になる。

**actor を渡す（5か所）**

| 場所 | 種別 | actor |
|---|---|---|
| `routes/follows.ts` `notifyFollowersOnPublish` | `followee_created_event` | `event.createdBy` |
| `routes/follows.ts` `notifyFollowersOnJoin` | `followee_joined_event` | 参加した `userId` |
| `routes/eventMeets.ts` `notifyMeet` | `meet` | 読み取った側 `me.id` |
| `routes/eventStaffInvites.ts` `notifyInvited` | `staff_invite` | `inviter.id`（本文に招待者名） |
| `routes/eventStaffInvites.ts` `notifyInviteResult` | `staff_invite_result` | `respondent.id`（本文に応答者名） |

follows の2つは、ユーザー行の取得に失敗して表示名がフォールバックに落ちる経路でも
**actor_id は必ず入れる**（id は分かっているため）。
文言のフォールバックと actor の特定は別物、というのがこの設計の眼目。

**actor を渡さない（21か所・NULL のまま）**

運営宛の検知、一斉連絡、繰り上がり、アンケート督促、たまごからの誕生、受賞、
問い合わせ、会場の権限変更・写真の審査結果、日程確定、当落、会場オファー。
いずれも主語が人でないか、受信者本人のことを知らせる通知。

`event_broadcast` と `inquiry_new` は「操作した人」を特定できるが、
**通知の文面にその人の名前が出ない**ので入れない。
入れると「主語が人か」ではなく「誰が押したか」の列に意味がずれ、後から
`DELETE WHERE actor_id = ?` の範囲を判断する根拠が失われる。

---

## 6. `deleteByActor` の新しい実装

```ts
/** 退会申請 (#250) で消す通知の種別 (#380)。
 *
 * 「退会する本人の名前が、他の利用者の通知一覧に出続けてしまう」ものだけを挙げる。
 * actor_id を埋めている種別と**わざと一致させていない**。埋めるのは
 * 「文面に名前が出る通知すべて」で、消すのはそのうち退会で消すと決めたものだけ。
 * 分けておかないと、actor_id を埋める範囲を広げた瞬間に削除範囲も黙って広がる。 */
const ACTOR_ERASED_TYPES = [
  "meet",
  "followee_created_event",
  "followee_joined_event",
] as const satisfies readonly NotificationType[];

/** 退会申請 (#250) したユーザーが「した側」として生成した通知を削除する。
 *
 * 判定は actor_id 一本 (#380)。以前は種別ごとに link / title から actor を
 * 推定していたが、
 *   - title の綴りに依存する＝通知の文言を変えた時点で消えなくなる
 *   - link / title は「現在の username・表示名」なので、改名した人を取りこぼす
 *   - 同姓同名が同席していると別人の通知まで消す
 * のいずれでも破れていた。actor_id ならどれも起きない。
 *
 * 復帰しても通知は戻らない（従来どおり）。 */
async deleteByActor(actorId: string): Promise<void> {
  await run(
    `DELETE FROM notification
      WHERE actor_id = ?
        AND type IN (${ACTOR_ERASED_TYPES.map(() => "?").join(", ")})`,
    actorId,
    ...ACTOR_ERASED_TYPES,
  );
}
```

呼び出し側は `deleteByActor(me)` → `deleteByActor(me.id)` の1行。
`username` / `globalName` を渡す必要が無くなること自体が、契約が1つになった証拠。

### 6.1 `deleteMeetSince` も寄せる

`link` を actor の代用に使う4か所目。同じ契約に寄せる。

```ts
async deleteMeetSince(userId: string, actorId: string, since: number): Promise<void> {
  await run(
    `DELETE FROM notification
      WHERE user_id = ? AND type = 'meet' AND actor_id = ? AND created_at >= ?`,
    userId, actorId, since,
  );
}
```

### 6.2 `mergeUsers` に1行足す（見落とすと壊れる）

`db/repositories/users.ts` の「UNIQUE の無い参照列は単純に付け替え」の
`simple` リストに `["notification", "actor_id"]` を追加する。

足さないと、負け側の user 行を削除したときに FK の `ON DELETE SET NULL` が発火して
actor_id が NULL になり、**統合後に勝ち側が退会しても通知が消えない**。
同じ理由の注意書きが `event_staff_invite.invited_by` の行に既にある。

---

## 7. 既存行の扱い

**埋め戻す。**

埋め戻さない案（旧条件を `deleteByActor` に残して両方で消す）は採らない。
「同じ契約が2か所」が残り、しかも残るほうの契約が
**まさに壊れる予定の title 依存**だからである。i18n 第3段階の直前に
「古い行のために title 依存を残してある」状態は、第3段階の作業者にとって
最も踏みたくない地雷になる。

代償として 4.2 の行は埋まらず消えないが、これは**現行実装でも消えていない行**
（同姓同名のケースだけは、現行が過剰に消していたのを消さない側に倒す）なので退行ではない。

---

## 8. 移行の順序（この節が本設計でいちばん壊れやすい）

このリポジトリは **デプロイ前に必ずマイグレーションを適用する** 運用で、
CI はマイグレーションを流さない（人が実行する）。したがって次の窓が空く。

```
 t0  0070 を適用（列が増える・既存行が埋まる）
     ↓  ← この間、旧コードが動いている
 t1  デプロイ完了（新コードが actor_id を書き始める）
```

**t0〜t1 に旧コードが書く行は actor_id が NULL になる。**
影響するのは3種別だけで、その窓の間に誰かがイベントを公開・参加・QR読み取りを
したときにだけ生まれる。

### 手順

1. **staging で先に通す。** 適用して埋め戻しの件数を確認する
   （`SELECT type, COUNT(1) FROM notification WHERE actor_id IS NOT NULL GROUP BY type`）。
2. 本番: マイグレーションを適用する。
3. **間を空けずに** デプロイする。
4. **デプロイ完了後、4.1 の埋め戻し3本をもう一度流す。**
   3本には `AND actor_id IS NULL` が付いているので冪等で、既に埋まった行には触れない。
   これで t0〜t1 に生まれた行が回収される。

**4 を忘れると窓の間の行が永久に埋まらない。** PR の本文と作業手順に必ず書くこと。
手作業を避けたい場合は、**次のリリース**で `0071_notification_actor_backfill.sql` として
同じ3本を入れる（0070 と同じ PR に入れてはいけない。未適用ぶんをまとめて流すので
t0 に両方走ってしまい意味が無い）。

### 切り戻し

コードだけ切り戻す場合、`actor_id` 列は残るが旧コードは列を無視するので害はない。
列を落とす操作は不要。

---

## 9. テストで確かめること

`apps/server/test/account-deletion-grace.test.ts` の該当箇所を作り直す。
いまのテストは生 INSERT で旧形式の行を手で作っているため、
**「文言を変えても消える」の証拠にならない**。

### 9.1 通知の文言を変えても消える

1. **実際の経路で通知を作らせる**（フォロー → 公開 / フォロー → 参加 / QR読み取り）。
   これで「作る側が actor_id を入れ忘れた」も同時に検出できる。
2. **通知が出来たあと、DB で `title` と `body` を別の文字列に書き換える。**
   i18n 第3段階の先取りで、**文言に依存していないことの直接の証拠**になる。
3. 退会申請する。
4. 3種別すべてが消えている。旧実装ならここで落ちる。

### 9.2 別のフォロイーを巻き込まない

フォロワー1人が A と B をフォロー → **同じイベント**に両方が参加 → A が退会 →
A の通知だけ消え B は残る。さらに **A と B の表示名を同じにした状態**でも B が残ること
（旧実装ではここで B も消えていた）。

### 9.3 改名しても消える

通知を作る → actor が username と表示名を変更 → 退会 → 3種別とも消える。

### 9.4 actor が居ない通知を巻き込まない

`actor_id IS NULL` の通知を混ぜて退会させ、1件も減っていないこと。

### 9.5 埋め戻しの検証

テスト用 D1 には全マイグレーションが適用済みなので「旧形式の行を入れてから流す」形は
取れない。新しいテストファイルを作り、**4.1 の3本と同じ SQL をテスト内に写して**実行する。

- 旧形式の行が正しく埋まる
- 同姓同名が2人居る行は**埋まらない**
- 別のイベントの同名参加者に誤って結び付かない
- meet で「ハンドルを手放した A / それを取った B」が居るとき B に付かない

SQL の二重管理になるが一度きりの処理なので許容する。
テストのコメントに「0070 と対。片方だけ直さないこと」と明記する。

### 9.6 統合との組み合わせ

負け側が actor の通知 → 統合 → **勝ち側**が退会 → 消える（6.2 の退行防止）。

### 9.7 出会いの取り消し

既存の検証（`since` より前の別の機会の通知に触らない）が `actor_id` 版でも通ること。

---

## 10. やらないこと（範囲の線引き）

- **通知の文言は変えない。** 種別＋値への作り直しは i18n 第3段階の仕事。
  本 PR はその前提条件だけを作る。
- **`actor_id` を API のレスポンスに出さない。** 画面が actor を必要とするのは第3段階からで、
  そのとき id ではなく表示名と遷移先の形で出すことになる。いま出すと、
  退会したユーザーの id が他人の一覧に載る経路が増える。
- **`staff_invite` / `staff_invite_result` を退会時の削除対象にしない。**
  actor_id は埋めるが `ACTOR_ERASED_TYPES` には入れない。
  招待そのものを退会時にどう扱うかと合わせて決めるべきで、#339 の設計を確認せずに
  広げると「招待が黙って消える」不具合になりうる。入れると決めたときは定数に1行足すだけ。
- **`link` を廃止しない。** 遷移先として引き続き必要。actor_id は link の代わりではない。
- **`actor_name` のスナップショットは持たない。** 名前を行に焼き込むのは、
  退会したら名前が見えなくなるという目的そのものに反する。
- **埋め戻せなかった行を救う特別処理はしない。**
- **通知テーブルの他の正規化（event_id 列など）はしない。** 第3段階の「値」の設計に
  含まれる話で、いま先回りすると第3段階の選択肢を狭める。

---

## 11. 変更するファイル

| ファイル | 変更 |
|---|---|
| `apps/server/migrations/0070_notification_actor.sql` | 新規（列・索引・埋め戻し） |
| `apps/server/src/db/repositories/notifications.ts` | `create`/`createForMany` に `actorId`、`deleteByActor` 書き換え、`deleteMeetSince` 書き換え、`ACTOR_ERASED_TYPES` |
| `apps/server/src/db/repositories/users.ts` | `mergeUsers` の `simple` に `["notification","actor_id"]` |
| `apps/server/src/routes/me.ts` | `deleteByActor(me)` → `deleteByActor(me.id)` |
| `apps/server/src/routes/follows.ts` | 2か所に `{ actorId }` |
| `apps/server/src/routes/eventMeets.ts` | `notifyMeet` に `{ actorId }`、`deleteMeetSince` の引数 |
| `apps/server/src/routes/eventStaffInvites.ts` | 2か所に `{ actorId }` |
| `apps/server/test/account-deletion-grace.test.ts` | 9.1〜9.4 |
| `apps/server/test/notification-actor-backfill.test.ts` | 新規（9.5） |
| `apps/server/test/account-merge.test.ts` | 9.6 |
| `apps/server/test/meet-scan.test.ts` | 9.7 |

新しい依存は無し。
