-- 参加アンケート (#152)。phase='pre' は参加登録時、'post' は事後 (#153 予約)
CREATE TABLE event_survey_question (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  phase TEXT NOT NULL DEFAULT 'pre',
  question TEXT NOT NULL,
  qtype TEXT NOT NULL DEFAULT 'text',   -- 'text' | 'select' | 'checkbox'
  options TEXT NOT NULL DEFAULT '[]',   -- select/checkbox の選択肢 JSON array
  required INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_survey_q_event ON event_survey_question(event_id, phase, sort_order);

CREATE TABLE event_survey_answer (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES event_survey_question(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  value TEXT NOT NULL DEFAULT '',       -- checkbox は JSON array 文字列
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_survey_a_unique ON event_survey_answer(question_id, user_id);
CREATE INDEX idx_survey_a_event ON event_survey_answer(event_id, user_id);
