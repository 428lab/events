-- 作成済みのスライドを AI に直してもらう（docs/agent-deck-token.md §4c。オーナー決定 2026-11-28）。
--
-- edit_deck_id: 個人のトークンを、発行の時点で既存の個人のデッキに結び付ける（チームのスライドは team_deck_id）。
--   有効な間は持ち主も編集できない（deckEditableSql）。FK は付けない（deck_id・team_deck_id と同じく、
--   デッキが消えたら次の書き込みが 410 deck_deleted を返す）。
-- deck_ai_backup: AI の最初の書き込みの直前の中身（「AIの変更を取り消す」で戻す）。1デッキ1行で、
--   次の AI のトークンが最初に書いたときに置き換わる。取り消したら消す。デッキを消せば消える。
ALTER TABLE deck_agent_token ADD COLUMN edit_deck_id TEXT;
CREATE INDEX idx_deck_agent_token_edit_deck ON deck_agent_token(edit_deck_id, expires_at)
  WHERE edit_deck_id IS NOT NULL;

CREATE TABLE deck_ai_backup (
  deck_id TEXT PRIMARY KEY REFERENCES deck(id) ON DELETE CASCADE,
  -- どの AI のトークンの前の中身か（同じトークンの2回目以降の書き込みでは置き換えない）
  token_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
