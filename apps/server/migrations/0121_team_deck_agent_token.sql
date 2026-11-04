-- チームのスライドもAIに土台を書いてもらう（docs/agent-deck-token.md §「チームのスライド」、オーナー決定 2026-11-04）。
--
-- team_deck_id: チームのスライドに結び付いたトークン。発行の時点でデッキが決まっている。
-- 既存の deck_id は UNIQUE（1トークンが作る個人のデッキ1つ）なので、同じチームのスライドに
-- トークンを何度も発行できるよう別の列にする。deck_id と同じく FK は張らない
-- （デッキが無くなれば AI の書き込みは 410 になるだけ）。
-- 有効なトークン（取り消しも期限切れもしていない）がある間、そのチームのスライドは
-- メンバーが編集できない（decks.ts の deckEditableSql）。1つのスライドに有効なのは1本だけ
-- （発行の INSERT … WHERE NOT EXISTS で確かめる）。
ALTER TABLE deck_agent_token ADD COLUMN team_deck_id TEXT;
CREATE INDEX idx_deck_agent_token_team_deck ON deck_agent_token(team_deck_id, expires_at)
  WHERE team_deck_id IS NOT NULL;

-- チームから外れた人が発行したトークンは、そのチームのスライドの分だけ取り消す
-- （抜けた人の AI がチームのスライドに書き続けない）。entry_member の行が消える経路
-- （抜ける・外す・移る・参加取消・ロール変更・ユーザー削除）はこのトリガー1つで拾う。
-- 退会の申請は accountDeletion.ts がその人のトークンを全部取り消す。
CREATE TRIGGER deck_agent_token_revoke_on_member_delete AFTER DELETE ON entry_member
BEGIN
  UPDATE deck_agent_token SET revoked_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
   WHERE owner_id = OLD.user_id AND revoked_at IS NULL
     AND team_deck_id IN (SELECT id FROM deck WHERE team_entry_id = OLD.entry_id);
END;
