-- 運営によるイベント内コンテンツの非表示 (#278)。
--
-- イベント内コンテンツのモデレーションは「そのイベントのスタッフだけ」に絞った (#275)。
-- その結果、終了済みイベント（参加登録もスタッフ追加もできない）に違反コンテンツが
-- 投稿され、スタッフが対応しない／スタッフ自身が投稿者、という場合に誰も手を出せない。
-- 運営をスタッフに加える経路は作らず、管理ダッシュボードから直接対処できるようにする。
--
-- **削除ではなく非表示**にする。誤って対処したときに戻せること、通報対応の証跡が
-- 残ることを優先する（誰がいつ対処したかは監査ログ #248 にも記録する）。
--
-- 既存データには一切影響しない追加のみ（すべて NULL 許容の列追加）。
-- NULL = 対処されていない、という既定になるので、移行時の UPDATE は不要。

-- 写真・写真コメント・イベントコメントには非表示の状態が無かった（削除しかない）ので
-- ここで持たせる。admin_hidden_by は対処した運営管理者の user id。
-- user への FK は張らない（退会・統合でユーザー行が消えても記録を残すため。
-- 監査ログ #248・要確認リスト #259 と同じ方針）。
ALTER TABLE event_photo ADD COLUMN admin_hidden_at INTEGER;
ALTER TABLE event_photo ADD COLUMN admin_hidden_by TEXT;
ALTER TABLE event_photo_comment ADD COLUMN admin_hidden_at INTEGER;
ALTER TABLE event_photo_comment ADD COLUMN admin_hidden_by TEXT;
ALTER TABLE event_comment ADD COLUMN admin_hidden_at INTEGER;
ALTER TABLE event_comment ADD COLUMN admin_hidden_by TEXT;

-- Q&A とチャットには既にスタッフ用の非表示の仕組みがある（event_question.hidden /
-- event_chat_hidden）ので、**その仕組みに載せる**。新しい非表示の経路を二重に作ると
-- 読み出し側の除外漏れが起きるため。
--
-- ここで足すのは「運営が対処したものか」の目印だけ。目印が付いている行は
-- スタッフの解除操作では戻せない（戻せてしまうと、対処した意味が無くなる）。
ALTER TABLE event_question ADD COLUMN admin_hidden_at INTEGER;
ALTER TABLE event_question ADD COLUMN admin_hidden_by TEXT;
ALTER TABLE event_chat_hidden ADD COLUMN admin_hidden_at INTEGER;
ALTER TABLE event_chat_hidden ADD COLUMN admin_hidden_by TEXT;
