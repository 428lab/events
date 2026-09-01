-- 共有URLの「初回訪問」数 (#450 フォローアップ)。日毎の件数だけを追加する
-- （引き続き IP・UA 等の個人情報は保存しない。判定はクライアントの
-- localStorage 申告＝分析用途の割り切り）
ALTER TABLE event_pre_survey_access ADD COLUMN first_count INTEGER NOT NULL DEFAULT 0;
