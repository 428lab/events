-- #408 動画投稿。event_photo を写真/動画共通のメディア行として拡張する。
-- 別テーブルにしない理由: 公開範囲 (PUBLIC_USER_PHOTO_COND)・コメント・
-- モデレーション (#278)・削除権限 (#275)・出席チェック連動 (#289)・退会時の purge が
-- すべて写真と同一で、分けるとこの全系統を二重化することになる（docs/video-upload.md §3）。
-- テーブル名が event_photo のまま動画を持つのは名前の負債だが、リネームは
-- 全リポジトリの SQL 文字列に波及するので別 issue とする。
ALTER TABLE event_photo ADD COLUMN kind TEXT NOT NULL DEFAULT 'photo'; -- 'photo' | 'video'
ALTER TABLE event_photo ADD COLUMN duration_ms INTEGER;  -- video のみ。表示用（クライアント申告値）
ALTER TABLE event_photo ADD COLUMN bytes INTEGER;        -- video のみ。容量把握用
ALTER TABLE event_photo ADD COLUMN mime TEXT;            -- video のみ。'video/webm' | 'video/mp4'
