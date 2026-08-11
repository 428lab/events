-- 運営スタッフへの招待 (#339)。
--
-- 公開前のイベントは既存メンバー以外には見えないため、本人が辿り着いて参加する
-- ことができない。運営側から指名して招き、**本人が承諾したときに初めて**
-- event_member の staff 行を作る。
--
-- なぜ event_member に 'invited' 状態を足さないか:
--   event_member.status は参加枠の選考状態（confirmed / applied / waitlist /
--   lost / canceled）の軸で、eventMembersRepo.find() は「status <> 'canceled'
--   ならメンバー」として扱う。ここに承諾前の状態を混ぜると、**承諾していない人が
--   メンバーとして扱われ**、公開前イベントの中身が全部見えてしまう
--   （routes/events.ts の canView がメンバー行の有無で判定しているため）。
--   別表に置けば既存のメンバー判定は一切変わらず、「承諾するまで運営ではない」が
--   構造として保証される。
CREATE TABLE event_staff_invite (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  -- 招待された人
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  -- 誰が招待したか (#339 の「誰が誰を追加したかが分かる」)。
  -- 招待した人が退会したら招待も消える（誰の紹介か分からない招待を残さない）。
  -- 通知は残るが、承諾のAPIは行が無ければ 404 になるので効力は無い
  invited_by TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  -- pending  = 相手の返事待ち（まだ運営ではない）
  -- accepted = 承諾済み（この時点で event_member の staff 行ができている）
  -- declined = 本人が辞退
  -- revoked  = 招待した側が取り消した
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  created_at INTEGER NOT NULL,
  -- 承諾・辞退・取り消しの時刻。pending のあいだは NULL
  responded_at INTEGER
);

-- 1イベント1ユーザー1行。断られた/取り消した相手を招き直すときは、この行を
-- pending に戻す（行を積み増さないので「いま有効な招待」が常に一意に決まる）
CREATE UNIQUE INDEX idx_event_staff_invite_pair
  ON event_staff_invite(event_id, user_id);
-- 「自分宛の返事待ちの招待」を引くための索引（招待一覧・通知からの導線）
CREATE INDEX idx_event_staff_invite_user
  ON event_staff_invite(user_id, status);
