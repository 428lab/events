-- 運営もチームに入ってコンテストに参加できるようにする（#536 のチーム版、docs/team-participation.md）。
--
-- 0115 の event_member_leave_team_on_update は「参加確定の参加者でなくなったら」チームから外していた。
-- 運営（staff）もチームのメンバーになれるようにしたので、参加確定の参加者か、確定の運営ならチームに残す。
-- 参加取消・当落・審査員／観覧者への変更・行の削除では今までどおり外れる（リーダーも外れる）。
-- 参加者から運営への変更ではチームに残る（チームの所属は席ではない。席を空ける #277 とは別の話）。
-- 外れたときのチームのスライドの鍵の作り直しは、0119 の entry_member の DELETE トリガーがそのまま行う。
DROP TRIGGER IF EXISTS event_member_leave_team_on_update;
CREATE TRIGGER event_member_leave_team_on_update AFTER UPDATE OF role, status ON event_member
WHEN NOT (NEW.status = 'confirmed' AND NEW.role IN ('participant', 'staff'))
BEGIN
  DELETE FROM entry_member WHERE user_id = NEW.user_id
    AND entry_id IN (SELECT id FROM entry WHERE event_id = NEW.event_id AND kind = 'team');
END;
