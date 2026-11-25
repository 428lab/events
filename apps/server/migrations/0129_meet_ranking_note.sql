-- 出会いランキングの画面に出す説明（任意）。オーナー依頼 2026-11-25
-- 「出会いランキングの画面に説明文を任意で追加できるようにしたい。上位x人に素敵なプレゼント！とか」。
-- 空文字は「出さない」。200字まで（MEET_RANKING_NOTE_MAX）。文字のまま出し、HTML や Markdown にはしない。
ALTER TABLE event ADD COLUMN meet_ranking_note TEXT NOT NULL DEFAULT '';
