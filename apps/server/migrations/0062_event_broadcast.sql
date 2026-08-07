-- 参加者への一斉連絡 (#172)。
--
-- スタッフが区分（全員/確定/キャンセル待ち/抽選の当落/スタッフ/審査員/観覧者/
-- 出席の有無）を選んでまとめて連絡する。アプリ内通知は送信時に作りきる。
-- メールは1リクエストで送れる件数に上限があるので、宛先を1行ずつ積んで
-- 定期実行で順次消化する。既存データには触れない（追加のみ）。

-- 送信1回ぶんの記録。スタッフだけが見る履歴でもあり、送信回数の上限判定にも使う。
-- 本文を持つのは、履歴で「何を送ったか」を後から確認できるようにするため。
CREATE TABLE event_broadcast (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  -- 送信したスタッフ。退会の完全削除でユーザー行が消えたら履歴も消える
  created_by TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  -- BROADCAST_SEGMENTS のいずれか。区分が増えても過去の記録を読めるよう TEXT で持つ
  segment TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  -- 送信時点でアプリ内通知を作った人数。あとから区分の人数が変わっても
  -- 「何人に届いたか」は動かしたくないので集計せずここに焼き込む
  recipient_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
-- 履歴の新しい順表示と、送信回数の上限判定（直近24時間・通算）に効かせる
CREATE INDEX idx_event_broadcast_event ON event_broadcast(event_id, created_at);

-- メールの送信待ち。1行 = 宛先1人ぶん。
--
-- メールアドレスは持たない。送信の直前に通知設定と identity から引き直すので、
-- 積んだ後にメール通知をオフにした人へは送られない（オフの人は skipped になる）。
-- アドレスを控えて持ち回らないので、個人データの置き場も増えない。
CREATE TABLE event_broadcast_email (
  id TEXT PRIMARY KEY,
  broadcast_id TEXT NOT NULL REFERENCES event_broadcast(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  -- pending（送信待ち）/ sent（送信済み）/ failed（規定回数失敗）/ skipped（対象外）
  status TEXT NOT NULL DEFAULT 'pending',
  -- 送信を試みた回数。上限に達したら failed に倒して無限に再試行しない
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER,
  created_at INTEGER NOT NULL
);
-- 定期実行が「古い送信待ちから順に」取り出すための索引
CREATE INDEX idx_event_broadcast_email_pending
  ON event_broadcast_email(status, created_at);
-- 送信状況（送信待ち/送信済み/失敗）の集計用
CREATE INDEX idx_event_broadcast_email_broadcast
  ON event_broadcast_email(broadcast_id);
