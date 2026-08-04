-- 退会の猶予期間 (#250)。退会リクエスト時は行を消さず deleted_at に時刻を記録し、
-- 即座に「利用不可・他者から非表示」にする。30日経過後に日次バッチ
-- (POST /api/cron/purge-deleted) が従来の完全削除 (deleteAccount) を実行する。
-- NULL = 在籍中。猶予期間中に同じログイン方法でログインすると復帰できる。
ALTER TABLE user ADD COLUMN deleted_at INTEGER;

-- 日次バッチが「30日経過した退会申請」だけを引くための部分インデックス。
-- 大多数の行は NULL なので WHERE 付きにして小さく保つ。
CREATE INDEX idx_user_deleted_at ON user(deleted_at) WHERE deleted_at IS NOT NULL;
