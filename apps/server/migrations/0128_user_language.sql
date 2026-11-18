-- お知らせとメールを受け取る人の言語で送る (#352)。オーナー決定 2026-11-19（案 A）。
--
-- language: 本人が最後に使った画面の言語、または設定で選んだ言語（'ja' / 'en'）。
--   NULL は「まだ分からない」で、サーバーは日本語で送る（これまでどおり）。
-- language_explicit: 1 = 設定で選んだ言語。画面を開いたときの自動の報告では上書きしない。
--   設定で「自動」に戻すと 0 に戻る。
ALTER TABLE user ADD COLUMN language TEXT;
ALTER TABLE user ADD COLUMN language_explicit INTEGER NOT NULL DEFAULT 0;
