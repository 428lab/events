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

-- (1) meet: link が actor 本人のプロフィールURL。event_meet の存在で裏を取る。
--
--     この EXISTS が見ているのは「その人と受信者がどこかで出会っているか」だけで、
--     通知のイベントや時刻とは対応していない。したがって
--     「A が手放したハンドルを B が取り、B も受信者と出会っている」場合は
--     B に結び付く。username は変更でき (PUT /api/me/username)、手放した
--     ハンドルは他人が取得できるので、link は「**いま**そのハンドルを持つ人」
--     しか指さない。
--
--     ガードは足していない。これは一度きりの操作で対象は適用時点のデータだけ
--     なので、「起きうるか」は推測ではなく**流す前に実データを見れば分かる**。
--     設計 8.1 の事前確認 SQL で「候補が2人以上になる meet 通知」と
--     「候補の出会いが通知より後にしか無い meet 通知」を数え、0件であることを
--     確かめてから流すこと。0件でなければ止めて判断する。
--     （本設計の作成時点で対象データに対して確認済み・該当0件）
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
--
--     NOT IN であって != ではない。ghost は完全削除が初めて起きたときに
--     遅延生成される (usersRepo.ensureDeletedUser) ので、まだ一度も完全削除が
--     走っていない DB では副問い合わせが NULL を返す。!= だと NULL 比較の結果が
--     NULL になり、正常な行まで含めて1件も埋まらない。NOT IN は空集合で TRUE。
--     副問い合わせが返すのは 0 行か非 NULL の1行だけなので、
--     NOT IN に NULL が混じって全体が NULL になる罠は踏まない。
UPDATE notification SET actor_id = (
    SELECT e.created_by FROM event e
     WHERE notification.link = '/events/' || e.id
       AND e.created_by NOT IN (SELECT id FROM user WHERE discord_id = 'system:deleted-user')
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
