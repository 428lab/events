-- スタッフの役割タグと持ち場 (#384)。
--
-- 3層: 役割の定義（イベントごと）→ 持ち場（時間帯×役割×人数）→ 割り当て（持ち場×人）。
-- 「この時間帯は受付が2人」を先に置き、あとから人を割り当てる。
-- 人数が先にあるから、埋まっていない持ち場が分かる。
--
-- 「役割」に role の語を使わない。event_member.role（権限: staff/judge/…）と
-- 読み違えるため。こちらは担当なので duty と呼ぶ。
--
-- **この3つの表は参加者に1行も返さない。** 読み書きする SQL は
-- db/repositories/eventDuties.ts の中にしか置かないこと。この不変条件は
-- test/staff-duty-sql-audit.test.ts が機械で守る（#393 の監査と同じ仕掛け）。
-- 既定のテンプレート（サービス共通の「受付」「司会」…）は持たない。#364
-- （保存データの言語）が未決のため。イベント複製が役割の定義をコピーする。

-- 役割の定義。イベントごとに主催者が作る。
CREATE TABLE event_staff_duty (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- 同名の役割を2つ作らせない（「受付」が2つあると、どちらに割り当てたか読めない）。
  -- この UNIQUE が (event_id, …) の索引を兼ねる。イベントあたり高々30件 (shared の
  -- EVENT_DUTY_LIMIT) なので並び替えはメモリで足り、sort_order の索引は張らない
  UNIQUE (event_id, name)
);

-- 持ち場。時間帯（#383 の event_schedule_item）× 役割 × 必要人数。
--
-- item は placement / visibility を問わない。司会・配信は**公開セッションに付く**
-- 仕事で、裏方の項目に限ると公開セッションの鏡写しの項目がもう1本要る。
-- unassigned も許す: トラック削除で項目が unassigned に**落ちる**（0067）とき、
-- 持ち場を道連れにしない（配置し直せば戻る。運営の入力を捨てない）。
--
-- event_id は持たない。項目→イベントの1本が正で、2か所に持つとずれる。
-- 所有チェックは item への JOIN で行う。
CREATE TABLE event_duty_slot (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES event_schedule_item(id) ON DELETE CASCADE,
  duty_id TEXT NOT NULL REFERENCES event_staff_duty(id) ON DELETE CASCADE,
  -- 「受付が2人」は行1本＋人数。人数ぶん行を作らない（枠に個性が無いのに
  -- 行だけ増え、並び・詰め替えの規則が要る）。上限は shared の DUTY_REQUIRED_MAX
  -- が持つ（DB にも書くと同じ契約が2か所になる）。下限だけ DB で止める
  required_count INTEGER NOT NULL CHECK (required_count >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- 同じ項目に同じ役割の持ち場は1つ（「受付2人」を2行に割らせない）
  UNIQUE (item_id, duty_id)
);
-- 役割の削除（CASCADE）と「この役割はどこで使われているか」を引く向き
CREATE INDEX idx_event_duty_slot_duty ON event_duty_slot(duty_id);

-- 割り当て。持ち場 × スタッフ。
--
-- 自前の id を持つ:「外れた担当」(除名・降格・退会申請) には名前も user_id も
-- 返さない（退会者の秘匿。#393 6.3 と同じ規則）ため、行を消す操作は
-- この id で指す。(slot_id, user_id) を鍵にすると user_id を画面へ返すことになる。
--
-- user_id は ON DELETE CASCADE。TODO の assignee (0073) が SET NULL なのと逆だが、
-- あちらの行は仕事そのもの（担当が消えても仕事は残す）、こちらの行はリンクだけ
-- （人が消えたら守る中身が無い）。SET NULL だと「誰でもない1枠」が空きを1つ隠す。
-- 消えれば持ち場は正しく「空き」に戻る。
--
-- **除名・降格・退会申請では行を触らない**（user 行も event_member 行も残る／
-- 片方だけ消えるので FK は発火しない）。「まだ担当者か」は読むときに
-- event_member と user.deleted_at から導出する（eventTodos の ASSIGNEE_JOIN と同じ）。
--
-- user(id) を参照する列を足すので mergeUsers への登録が要る。(slot_id, user_id) の
-- UNIQUE があるため simple ではなく uniqueKeyed に足すこと（test/merge-user-columns
-- .test.ts (#396) が登録漏れと数の不一致を落とす）。
CREATE TABLE event_duty_assignee (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES event_duty_slot(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  -- 同じ人を同じ持ち場に二重に割り当てない
  UNIQUE (slot_id, user_id)
);
-- mergeUsers の付け替えと「この人の持ち場」を引く向き
CREATE INDEX idx_event_duty_assignee_user ON event_duty_assignee(user_id);
