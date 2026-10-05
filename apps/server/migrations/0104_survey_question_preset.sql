-- 参加アンケートの定型の質問（写真NG / No photo）。
-- NULL は主催者が書いた通常の質問、'no_photo' は写真NGのプリセット。
-- 文言は表示側が閲覧者の言語の辞書で出し、回答は言語に依存しない 'ok' / 'no_photo' で保存する。
ALTER TABLE event_survey_question ADD COLUMN preset TEXT;
-- 同じプリセットは1イベントに1問まで
CREATE UNIQUE INDEX idx_survey_q_event_preset ON event_survey_question(event_id, preset) WHERE preset IS NOT NULL;
