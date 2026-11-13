-- プロフィールの「スライド」タブ（docs/profile-tabs.md「スライド」・docs/slide-editor.md「プロフィールに載せる」）。
--
-- 1) profile_deck: 本人が選んだ「載せる／載せない」(show 1/0)。オプトイン（行が無ければ載せない）。
--    載せられるのは自分の個人のデッキと、自分がメンバーのチームのスライド。
--    デッキが消えたら行も消える。退会の完全削除でも消える（CASCADE）。
--    アカウント統合では勝ち側へ移す（同じデッキに両方の行があれば負け側を捨てる）。
-- 2) profile_setting: 「スライドをプロフィールに自動で載せる」(auto_show_decks)。既定はオフ。
--    オンのときは、profile_deck で show=0 にしたもの以外の、載せられるデッキすべて（今あるものと
--    これから作るもの）を載せる。載せるかの判定は decks.ts の deckShownOnProfileSql 1か所。
--    通知設定 (notification_pref) とは別の表にする（通知の設定ではないため）。統合は同じ型（勝ち側優先）。
-- 3) deck_view_unique: 公開ビューア /d/:slug の表示回数。イベントの閲覧 (0024) と同じく生IPは持たず、
--    visitor cookie で日ごとに重複を除く。表示回数 = この表の行数（日ごとのユニーク訪問者の合計）。
--    持ち主・チームのメンバーの閲覧は数えない。
CREATE TABLE profile_deck (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  deck_id TEXT NOT NULL REFERENCES deck(id) ON DELETE CASCADE,
  show INTEGER NOT NULL CHECK (show IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, deck_id)
);
CREATE INDEX idx_profile_deck_deck ON profile_deck(deck_id);

CREATE TABLE profile_setting (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  auto_show_decks INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE deck_view_unique (
  deck_id TEXT NOT NULL REFERENCES deck(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  PRIMARY KEY (deck_id, day, visitor_id)
);
