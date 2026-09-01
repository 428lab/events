-- 開催前アンケート (#444)。下書きイベントの主催者が作り、トークンURLで配る。
-- イベント本体は見せない（回答者に返るのはこの表と質問の内容だけ。
-- docs/pre-event-survey.md §3.2）
CREATE TABLE event_pre_survey (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE REFERENCES event(id) ON DELETE CASCADE, -- 1イベント1件
  token TEXT NOT NULL UNIQUE,       -- 128bit 乱数(32hex)。再発行で置換＝旧URL即無効
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'closed'
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);

CREATE TABLE event_pre_survey_question (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES event_pre_survey(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  qtype TEXT NOT NULL DEFAULT 'text',   -- SURVEY_QTYPES（#152 と同じ enum を共用）
  options TEXT NOT NULL DEFAULT '[]',
  required INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL
);
CREATE INDEX idx_pre_survey_q ON event_pre_survey_question(survey_id, sort_order);

-- 回答1件＝1人の送信（未ログインは user_id NULL。送信1回きり・編集なし）
CREATE TABLE event_pre_survey_response (
  id TEXT PRIMARY KEY,
  survey_id TEXT NOT NULL REFERENCES event_pre_survey(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES user(id) ON DELETE SET NULL,  -- 退会でも集計を痩せさせない
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_pre_survey_r ON event_pre_survey_response(survey_id, created_at);

CREATE TABLE event_pre_survey_answer (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL REFERENCES event_pre_survey_response(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES event_pre_survey_question(id) ON DELETE CASCADE,
  value TEXT NOT NULL DEFAULT ''        -- checkbox は JSON array 文字列（#152 と同じ形）
);
CREATE INDEX idx_pre_survey_a ON event_pre_survey_answer(response_id);
CREATE INDEX idx_pre_survey_a_q ON event_pre_survey_answer(question_id);
