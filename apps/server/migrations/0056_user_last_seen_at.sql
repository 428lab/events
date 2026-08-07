-- DAU/WAU/MAU・リテンション・休眠復帰を出すための計測基盤 (#257)。
--
-- これまでログイン/アクセスの記録が一切なく（session に作成日時が無く、user に
-- 最終アクセス日時も無い）、アクティブユーザー数を後から算出する手段が無かった。
-- 認証を通ったリクエストで最終アクセス時刻（epoch ms）をここに記録する。
--
-- 更新は auth/session.ts の currentUser（全リクエストの認証が通る1箇所）から、
-- **JST の日付が変わった最初の1回だけ**行う。同じ日に何度アクセスしても
-- UPDATE は1回で、D1 への書き込み（サブリクエスト）は 1ユーザー 1日 1回に収まる。
-- 退会申請中 (deleted_at IS NOT NULL) のユーザーは更新しない。
--
-- **既存ユーザーのバックフィルはしない**（NULL のまま）。この列は
-- 「このマイグレーションを本番投入した日以降」のデータしか持たない。
-- 集計側は NULL を「計測開始前」として扱い、計測開始日より前の期間について
-- DAU/MAU を出さないこと（0 になって「アクティブが居ない」ように見えてしまう）。
ALTER TABLE user ADD COLUMN last_seen_at INTEGER;

-- 集計用インデックス（次のPRで作る DAU/MAU 系クエリの想定）:
--   - DAU/WAU/MAU: SELECT COUNT(1) FROM user WHERE last_seen_at >= ?
--   - 日別の推移:   ... WHERE last_seen_at >= ? GROUP BY strftime('%Y-%m-%d', last_seen_at/1000 + 32400, 'unixepoch')
--   - 休眠/コホート: ... WHERE last_seen_at < ?（一定期間アクセスの無いユーザー）
-- いずれも last_seen_at の範囲検索が先頭に来るので単独インデックスで足りる。
-- user(created_at) と同じ方針。deleted_at のような部分インデックスにはしない
-- （計測が回り始めれば大半の行に値が入るため、WHERE 付きにする意味が無い）。
CREATE INDEX idx_user_last_seen_at ON user(last_seen_at);
