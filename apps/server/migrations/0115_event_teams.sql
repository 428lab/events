-- コンテストのチーム参加 (#9, docs/team-participation.md)。
-- チーム＝ entry(kind='team')。メンバー＝ entry_member（is_leader がリーダー）。
-- チーム参加かどうかは既存の event.participation_type（'individual' | 'team'）。

-- チームの説明と定員（NULL は上限なし）。個人エントリーでは使わない
ALTER TABLE entry ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE entry ADD COLUMN capacity INTEGER;

-- 個人エントリーはチーム参加中も今までどおり作られ、残る（画面・採点・表彰に出さないだけ）。
-- 「いま使う種類」は event.participation_type で決まり、entries.ts の activeEntrySql が絞る。
-- だから切り替えてもデータは消えず、戻せば元のまま出てくる。

-- 参加確定の参加者でなくなったら（取消・当落・権限の取り消し・運営への変更・行の削除）、
-- そのイベントのチームから外す。リーダーだった場合はリーダーも外れる（運営が立て直す）。
-- UPDATE OF role, status だけを見るので、アカウント統合の user_id 付け替えでは動かない。
CREATE TRIGGER event_member_leave_team_on_update AFTER UPDATE OF role, status ON event_member
WHEN NOT (NEW.role = 'participant' AND NEW.status = 'confirmed')
BEGIN
  DELETE FROM entry_member WHERE user_id = NEW.user_id
    AND entry_id IN (SELECT id FROM entry WHERE event_id = NEW.event_id AND kind = 'team');
END;

CREATE TRIGGER event_member_leave_team_on_delete AFTER DELETE ON event_member
BEGIN
  DELETE FROM entry_member WHERE user_id = OLD.user_id
    AND entry_id IN (SELECT id FROM entry WHERE event_id = OLD.event_id AND kind = 'team');
END;

-- 1人が同じイベントで入れるチームは1つだけ。チームを移るときは、先に元のチームの行を消してから入れる
CREATE TRIGGER entry_member_one_team_per_event BEFORE INSERT ON entry_member
WHEN EXISTS (SELECT 1 FROM entry target WHERE target.id = NEW.entry_id AND target.kind = 'team'
  AND EXISTS (SELECT 1 FROM entry_member em JOIN entry other ON other.id = em.entry_id
    WHERE em.user_id = NEW.user_id AND other.event_id = target.event_id
      AND other.kind = 'team' AND other.id <> target.id))
BEGIN
  SELECT RAISE(ABORT, 'team_already_joined');
END;
