-- 開催前アンケートの共有URLアクセス数 (#450)。**日毎の件数だけ**を持つ。
-- IP・User-Agent・時刻の詳細など個人を特定しうる情報は保存しない。
-- キーが survey_id なのでトークン再発行をまたいで集計が続く
CREATE TABLE event_pre_survey_access (
  survey_id TEXT NOT NULL REFERENCES event_pre_survey(id) ON DELETE CASCADE,
  day TEXT NOT NULL,             -- JST の 'YYYY-MM-DD'（jstDay()/jd() と同じ基準）
  count INTEGER NOT NULL,
  PRIMARY KEY (survey_id, day)
);
