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
  -- 送信時点でアプリ内通知を作れた人数。あとから区分の人数が変わっても
  -- 「何人に届いたか」は動かしたくないので集計せずここに焼き込む
  recipient_count INTEGER NOT NULL,
  -- 1 = 通知の一括作成が途中で失敗した（区分の一部の人にしか届いていない）。
  -- 履歴に出して「同じ内容をもう一度送ると二重に届く」ことが分かるようにする
  incomplete INTEGER NOT NULL DEFAULT 0,
  -- メールの送信状況のカウンタ。
  --
  -- 集計を event_broadcast_email 側の GROUP BY で出すと、履歴を1回引くたびに
  -- そのイベントの送信待ち行を全件読むことになる。履歴の画面は送信待ちが残る間
  -- 15秒ごとに再取得するので、300人規模なら1人が画面を開くだけで読み取り行数が
  -- 跳ね上がる。ここに持てば履歴の取得は event_broadcast の行だけで済む。
  --
  -- pending は「まだ終わっていない」件数（送信中を含む）。
  -- 合計 = email_pending + email_sent + email_failed + email_skipped で不変。
  -- 更新は送信待ちの状態遷移と同じ batch（＝同一トランザクション）で行い、
  -- 1行は必ず claim した1つの実行だけが遷移させるのでズレない。
  email_pending INTEGER NOT NULL DEFAULT 0,
  email_sent INTEGER NOT NULL DEFAULT 0,
  email_failed INTEGER NOT NULL DEFAULT 0,
  email_skipped INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
-- 履歴の新しい順表示と、送信回数の上限判定（直近24時間・通算）に効かせる
CREATE INDEX idx_event_broadcast_event ON event_broadcast(event_id, created_at);
-- 定期実行が「まだ送り終わっていない連絡」を拾うための部分インデックス。
-- 送り終わった連絡は条件から外れるので、索引には処理中のものしか載らない
CREATE INDEX idx_event_broadcast_pending ON event_broadcast(created_at)
  WHERE email_pending > 0;

-- メールの送信待ち。1行 = 宛先1人ぶん。
--
-- メールアドレスは持たない。送信の直前に通知設定と identity から引き直すので、
-- 積んだ後にメール通知をオフにした人へは送られない（オフの人は skipped になる）。
-- アドレスを控えて持ち回らないので、個人データの置き場も増えない。
CREATE TABLE event_broadcast_email (
  id TEXT PRIMARY KEY,
  broadcast_id TEXT NOT NULL REFERENCES event_broadcast(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  -- pending（送信待ち）/ sending（取り出し済み・送信中）/ sent（送信済み）/
  -- failed（見切りをつけた）/ skipped（対象外）
  --
  -- sending があるのは、定期実行と送信直後のその場消化が重なったときに
  -- 同じ行を2つの実行が拾って同じメールを2通送るのを防ぐため。取り出しは
  -- 「pending の行を sending に倒して、倒せた行だけを自分のぶんとする」形にする。
  -- 途中で実行が落ちて sending のまま残った行は、claimed_at が古くなったら
  -- 次の実行が拾い直す。
  status TEXT NOT NULL DEFAULT 'pending',
  -- 送信を試みて「送れないまま終わった」回数（取り出し時に加算し、
  -- 一時的な失敗と予算切れでは戻す）。上限に達したら failed に倒す。
  -- 実質、実行が落ちて sending のまま残るのを繰り返す行を止めるための数
  attempts INTEGER NOT NULL DEFAULT 0,
  -- 一時的な失敗（レート超過・5xx・通信エラー・鍵の設定ミス）で見送った回数。
  -- attempts を消費させずに次回の試行を後ろへずらすために別に数える。
  -- メール配信側の障害が続いてもその場で全滅させず、時間を空けて粘る
  deferrals INTEGER NOT NULL DEFAULT 0,
  -- この時刻より前は取り出さない（一時的な失敗のときのバックオフ）。0 = すぐ対象
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  -- sending に倒した時刻。古いまま残っていたら実行が落ちたとみなして拾い直す
  claimed_at INTEGER,
  sent_at INTEGER,
  created_at INTEGER NOT NULL
);
-- 定期実行が「この連絡の、いま送れる送信待ちを古い順に」取り出すための索引。
-- 連絡ごとに取り出すのは、送信待ちが多い連絡が他のイベントの連絡を
-- 待たせ続けないよう、連絡どうしで順番を分け合うため
CREATE INDEX idx_event_broadcast_email_pick
  ON event_broadcast_email(broadcast_id, status, next_attempt_at, created_at);
