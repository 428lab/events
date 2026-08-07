-- DAU/WAU/MAU・リテンション・休眠復帰を出すための計測基盤 (#257)。
--
-- これまでログイン/アクセスの記録が一切なく（session に作成日時が無く、user に
-- 最終アクセス日時も無い）、アクティブユーザー数を後から算出する手段が無かった。
-- 認証を通ったリクエストで、次の2つを記録する。
--   1. user.last_seen_at … 最終アクセス時刻(epoch ms)。「今どれだけ休眠か」用
--   2. user_active_day  … 「その日アクセスした」事実の日次記録。「推移」用
--
-- 更新は auth/session.ts の currentUser（全リクエストの認証が通る1箇所）から、
-- **JST の日付が変わった最初の1回だけ**行う。同じ日に何度アクセスしても
-- 書き込みは1回きりで、しかも上の2文は D1 の batch でまとめて1回で流す。
-- 退会申請中 (deleted_at IS NOT NULL) のユーザーは記録しない。
--
-- **既存ユーザーのバックフィルはしない**（NULL のまま／過去日の行は作らない）。
-- ここに入るのは「このマイグレーションを本番投入した日以降」のデータだけ。
-- 集計側は計測開始日より前の期間について DAU/MAU を出さないこと
-- （0 になって「アクティブが居ない」ように見えてしまう）。
ALTER TABLE user ADD COLUMN last_seen_at INTEGER;

-- 「最終アクセスが N 日より前」＝休眠ユーザーの抽出用。範囲検索が先頭に来るので
-- 単独インデックスで足りる。user(created_at) と同じ方針。deleted_at のような
-- 部分インデックスにはしない（計測が回れば大半の行に値が入るため意味が無い）。
CREATE INDEX idx_user_last_seen_at ON user(last_seen_at);

-- 日次の活動記録。1ユーザー1日ちょうど1行（INSERT OR IGNORE）。
--
-- last_seen_at は「**最終**アクセス日」しか持たないので、これを日別に GROUP BY
-- しても出るのは「今どれだけ休眠しているか」の分布であって DAU の推移ではない
-- （毎日来る人は最新日にしか計上されない。休眠から復帰しても前回値が上書きされて
-- 復帰したこと自体が消える）。過去日まで遡れる推移・コホートはこの表でしか出せない。
--
-- user への FK は張らない。退会・完全削除でユーザー行が消えても過去の集計値が
-- 動かないようにするため（監査ログ #248 と同じ方針）。
--
-- 保存期間: **当面は無制限**。1行あたり day 10B + uuid 36B ＝ 実効 50B 前後で、
-- 仮に DAU 1,000 人でも 1,000 × 365 ≒ 36.5万行/年、索引込みでも数十MB/年にしか
-- ならず D1 の容量に対して十分小さい。加えてコホート残存は「1年前に入った人が
-- 今も来ているか」のような長い窓を見るのが目的なので、機械的に古い行を消すと
-- 容量より先に分析の方が壊れる。行数が数百万規模（DAU 1万人規模）に届いたら、
-- purge-deleted と同じ日次バッチに「N年より古い day を削除」を足すこと。
CREATE TABLE user_active_day (
  day TEXT NOT NULL,     -- JST の 'YYYY-MM-DD'
  user_id TEXT NOT NULL, -- FK は張らない（上記の理由）
  PRIMARY KEY (day, user_id)
);

-- 集計クエリ（画面は別PR）の想定と、効くインデックス:
--   - DAU:       SELECT COUNT(1) FROM user_active_day WHERE day = ?
--   - 日別の推移: SELECT day, COUNT(1) FROM user_active_day
--                  WHERE day BETWEEN ? AND ? GROUP BY day
--   - WAU/MAU:   SELECT COUNT(DISTINCT user_id) FROM user_active_day
--                  WHERE day BETWEEN ? AND ?
--     … ここまでは PRIMARY KEY (day, user_id) の先頭列だけで足りる
--   - コホート残存/休眠復帰: 特定ユーザーの活動日を並べる（user_id で絞る）
--     … 下のインデックスが要る。day も含めるとインデックスだけで完結する
CREATE INDEX idx_user_active_day_user ON user_active_day(user_id, day);
