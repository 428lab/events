-- チームのスライド (docs/team-participation.md「チームのスライド」)。
--
-- 1) deck.team_entry_id: チーム参加のコンテストで、チーム (entry kind='team') に結び付いたデッキ。
--    1チーム1つ（下の部分 UNIQUE）。編集できるのはそのチームの「いまの」メンバーで、
--    作った人（owner_id）に特別な権限は無い。チームが消えたら（空のチームしか消せない）
--    結び付きだけ外れて、作った人の個人のデッキに戻る（ON DELETE SET NULL）。
-- 2) deck.revision: 保存のたびに 1 進む。編集画面は読み込んだ版を添えて保存し、
--    その間にほかの人（別のタブ・チームのメンバー・AI エージェント）が保存していたら
--    409 で止める（あとから保存した側が黙って上書きしない）。
-- 3) deck.last_saved_by: 最後に保存した人（「最後に保存: ○○さん」の表示用）。
--    user を参照するので、アカウント統合で勝ち側へ付け替える（accountMerge.ts）。
--    退会の完全削除では SET NULL（名前が出なくなるだけ）。
ALTER TABLE deck ADD COLUMN team_entry_id TEXT REFERENCES entry(id) ON DELETE SET NULL;
ALTER TABLE deck ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deck ADD COLUMN last_saved_by TEXT REFERENCES user(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_deck_team_entry ON deck(team_entry_id) WHERE team_entry_id IS NOT NULL;
