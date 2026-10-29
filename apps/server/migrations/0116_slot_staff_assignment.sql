-- スタッフを参加枠に並べる・運営だけが割り当てる枠 (docs/staff-slot-assignment.md)。
--
-- 1) event_member.assigned_slot_id: スタッフ・審査員・観覧者（参加者以外のロール）を、運営が
--    参加者一覧のどの枠の見出しの下に並べるかだけを持つ。席の判定はしない。
--    slot_id（参加者が申し込んだ枠）は今までどおり参加者だけが持つ（#277）。定員・抽選・
--    キャンセル待ち・繰り上げ・0108 の在籍数カウンター・名札の枠別デザイン・一斉連絡の
--    枠別宛先は、どれも slot_id だけを見るので、この列では一切動かない。
--    user を参照しないので、アカウント統合・退会の登録（userTables）は要らない。
ALTER TABLE event_member ADD COLUMN assigned_slot_id TEXT REFERENCES participation_slot(id) ON DELETE SET NULL;
-- 枠を消したときの ON DELETE SET NULL が event_member を全件なめないように
CREATE INDEX idx_event_member_assigned_slot ON event_member(assigned_slot_id);

-- 参加者に戻った行は割り当てを持たない（参加者の枠は slot_id で、本人の申込で決まる）。
-- ロールが変わるすべての経路（ロール変更・取消からの再参加・自動登録）をここでまとめて塞ぐ
CREATE TRIGGER event_member_clear_assigned_slot AFTER UPDATE OF role ON event_member
WHEN NEW.role = 'participant' AND NEW.assigned_slot_id IS NOT NULL
BEGIN
  UPDATE event_member SET assigned_slot_id = NULL WHERE id = NEW.id;
END;

-- 2) participation_slot.staff_only: 運営が割り当てる枠（参加者は選べない）。
--    参加者の申込・自動登録では選べず、席の数（イベントの「参加 n / 上限」）にも入れない。
--    オンにする前にこの枠を選んでいた参加者の行はそのまま残す（新しい申込だけを止める）。
ALTER TABLE participation_slot ADD COLUMN staff_only INTEGER NOT NULL DEFAULT 0;

-- 0108 の在籍数カウンター（トリガー）は変えない。イベントの「参加 n / 上限」の上限から
-- この枠を外すのは、読む側の式（events.ts の EVENT_COUNTER_COLUMNS / CAPACITY_TOTAL_SQL）で行う。
