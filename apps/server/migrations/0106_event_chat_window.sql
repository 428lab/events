-- 参加者チャットに書き込める期間を主催者が選べるようにする (#578)。
-- 既定値は従来の「開始30分前〜終了2時間後」なので、既存のイベントの振る舞いは変わらない。
-- 期間の計算は packages/shared/src/eventChat.ts の chatWriteWindow。

-- 開始の何分前から書き込めるか。NULL は下限なし（参加が確定したらすぐ）。
-- 値は 30 か、1〜30日（1440 の倍数）。検証は共有の zod スキーマ
ALTER TABLE event ADD COLUMN chat_open_before_minutes INTEGER DEFAULT 30;
-- 終了の何分後まで書き込めるか。120（2時間）/ 1440（1日）/ 10080（7日）
ALTER TABLE event ADD COLUMN chat_close_after_minutes INTEGER NOT NULL DEFAULT 120;
