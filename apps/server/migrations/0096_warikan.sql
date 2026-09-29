-- 割り勘 (#556)。金額は円のみ。
-- このアプリは送金も金銭の預託も換算もしない。支払いの確認もしない。
-- 持つのは立替の帳簿・当事者が付けた「済み」・受け取り先の掲示だけ（設計 §3.1）
-- event 側にオン/オフの列は持たない（設計 §3.3）
--
-- 帳簿の当事者（payer / share / 済みの from・to）の user FK には ON DELETE を付けない
-- （= user 行の削除をブロックする）。退会では ghost へ、統合では勝ち側へ
-- 必ず付け替えてから user を消す（設計 §3.3「退会・統合」）。付け替えを
-- 忘れた経路は黙って他人の金額を動かすのではなく、FK 違反で止まる

-- 立替1件（誰が・いくら・何に払ったか）
CREATE TABLE event_expense (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  payer_user_id TEXT NOT NULL REFERENCES user(id),    -- 立て替えた人。入力者とは別
  amount INTEGER NOT NULL,                            -- 円（整数）
  title TEXT NOT NULL,                                -- 「会場費」「打ち上げ」など
  note TEXT NOT NULL DEFAULT '',
  spent_on TEXT,                                      -- 'YYYY-MM-DD'（任意。isDateOnly で検証）
  created_by TEXT REFERENCES user(id) ON DELETE SET NULL,  -- 入力した人（表示と編集権に使う）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (amount > 0)
);
CREATE INDEX idx_event_expense_event ON event_expense(event_id, created_at);
CREATE INDEX idx_event_expense_payer ON event_expense(payer_user_id);

-- この立替を誰で割るか。1人1行。weight は整数の重み（等分は全員 1）
CREATE TABLE event_expense_share (
  expense_id TEXT NOT NULL REFERENCES event_expense(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id),
  weight INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (expense_id, user_id),
  CHECK (weight > 0)
);
CREATE INDEX idx_event_expense_share_user ON event_expense_share(user_id);

-- 精算の行 (from → to) に当事者が付けた「済み」（設計 §3.5.1）。
-- 精算の行は立替から毎回導出されるので、行の id は無い。(event, from, to) が行の identity。
-- amount は「済み」を付けた時点の精算額。読むときに現在の導出額と一致する行だけが「済み」として効く
-- （額が変われば自動的に外れる。立替の編集・削除に追随するロジックを別に持たない）。
-- marked_by が当事者であることは INSERT の WHERE と route で守る。CHECK にはしない
-- （退会の付け替えで from → ghost に書き換える瞬間に marked_by が当事者でなくなり、CHECK が止めてしまう）
CREATE TABLE event_settlement_done (
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  from_user_id TEXT NOT NULL REFERENCES user(id),      -- 支払う側
  to_user_id TEXT NOT NULL REFERENCES user(id),        -- 受け取る側
  amount INTEGER NOT NULL,                             -- 付けた時点の精算額（円）
  marked_by TEXT REFERENCES user(id) ON DELETE SET NULL,  -- 付けた当事者（from か to）。表示にだけ使う
  marked_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, from_user_id, to_user_id),
  CHECK (amount > 0),
  CHECK (from_user_id <> to_user_id)
);
CREATE INDEX idx_event_settlement_done_from ON event_settlement_done(from_user_id);
CREATE INDEX idx_event_settlement_done_to ON event_settlement_done(to_user_id);

-- 受け取り先（イベント内・本人のもの）。**受け取るために公開する識別子だけ**（設計 §3.6）。
-- 銀行口座はこの表に入れない。kind の CHECK がその門で、'bank' を足すには
-- テーブル再構築が要る＝「うっかり足す」ができない形にしてある。
-- 自由記述の表示名（label）は持たない（口座番号を書ける欄を作らないため）
CREATE TABLE event_payout_method (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,  -- 受け取る本人。退会で消える
  kind TEXT NOT NULL,                  -- 'url' | 'lightning'
  value TEXT NOT NULL,                 -- https の URL / LN Address・LNURL
  created_at INTEGER NOT NULL,
  CHECK (kind IN ('url', 'lightning'))
);
CREATE INDEX idx_event_payout_method_owner ON event_payout_method(event_id, user_id);
