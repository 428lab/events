-- スタッフ向けの TODO とガントチャート (#393)。
--
-- 準備期間（日〜週）の段取りを置く。「会場を押さえる」「告知を出す」「備品を買う」
-- のような、イベント当日より**前**の仕事。
--
-- **当日の段取り (#383) とは別の表にしている。** あちらは event_schedule_item で
-- 分単位・トラック・カーソル連鎖を持つ。同じ表に載せると
--   - 参加者向けの絞り込みが 13 経路あり、値を1つ増やすたびに全部を確かめ直すことになる
--     （#383 で、拒否リスト形式の絞り込みを新しい値が黙って通り抜けることが実証済み）
--   - epoch の starts_at / duration_min / placement と、due_on / status / assignee が
--     互いに半分ずつ NULL の表になる
--   - computeScheduleTimes の連鎖の規則がもう1種類増える
-- 時間軸が違うものを同じ表に載せない。
--
-- **この2つの表は参加者に1行も返さない。** 読み書きする SQL は
-- db/repositories/eventTodos.ts の中にしか置かないこと。この不変条件は
-- test/staff-todo-sql-audit.test.ts が機械で守る（#383 の SQL 監査と同じ仕掛け）。
-- 「イベント詳細にも出そう」と思ったら、まずそのテストの許可リストに理由を書く。

CREATE TABLE event_todo (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  -- 補足。任意。長文の手順書ではなく「どこに電話するか」程度を想定
  note TEXT,

  -- 期間。**日付だけ**を持ち、時刻は持たない (#393 の対象は日〜週)。
  --
  -- 形式は 'YYYY-MM-DD' の TEXT。
  --   - epoch ms にすると、UTC 0時で保存した 9/1 が
  --     ローカル整形で 8/31 に見える人が出る（同じ期限が人によって別の日になる）
  --   - TEXT の辞書順が**そのまま日付順**なので ORDER BY / 比較がそのまま効く
  --   - <input type="date"> の value と同じ形なので、画面の端で変換が要らない
  -- どのタイムゾーンの日かは決めない。9/1 は誰にとっても 9/1 と表示・入力される。
  --
  -- 両方 NULL でよい（日付未定の仕事は一覧にだけ載り、ガントには出ない）。
  -- starts_on だけ NULL のときは due_on の1日だけの帯（マイルストーン）として描く。
  starts_on TEXT CHECK (starts_on IS NULL OR starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  due_on    TEXT CHECK (due_on    IS NULL OR due_on    GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),

  -- 2値だけ。'blocked'（待ち）と 'overdue'（遅れ）は**列にしない**。
  -- どちらも依存先の状態と今日から導出できる。列にすると、依存先を done にした
  -- 瞬間・日付が変わった瞬間に更新して回る仕事が生まれ、漏れると
  -- 「実際は動けるのに待ちと表示される」形で古びる。導出は古びない。
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  done_at INTEGER,

  -- 担当（1人）。**複数人・人数・役割は #384 の仕事**なので、ここでは増やさない。
  --
  -- ON DELETE SET NULL:
  --   完全削除 (#244) でユーザー行が消えたときに、仕事そのものを消したくない。
  --   「会場を押さえる」はイベントの仕事であって担当者の持ち物ではない。
  --   CASCADE にすると、スタッフが1人アカウントを消しただけで
  --   その人が担当していた準備が全部消える。notification.actor_id (#380) と
  --   venue_photo.user_id (0032) と同じ形。
  --
  -- **除名・降格・退会申請では、この列は触らない。** どれも user 行も
  -- event_member 行も残る／片方だけ消える（設計 2.3 の表）ので FK は発火しない。
  -- 「まだ担当者か」は取得時に event_member と user.deleted_at を見て導出する。
  -- ここを消して回ると、メンバーを外す経路（除名・脱退・降格・退会）の数だけ
  -- 同じ契約が散る。導出なら1か所で済む。
  assignee_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,

  -- 誰が足した仕事か。表示には使わず、荒れたときに辿るためだけに持つ。
  -- 担当と同じ理由で SET NULL（作成者が消えても仕事は残す）
  created_by TEXT REFERENCES user(id) ON DELETE SET NULL,

  -- 一覧の並び。**ガントの行順もこれに従う**（日付順や依存の順に自動で並べ替えない。
  -- 並べ替えると、依存を1本足しただけで行が動き、一覧とガントで順序が食い違う）
  sort_order INTEGER NOT NULL,

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  -- 逆さまの期間を作らせない。DB で表現できる不整合は DB で止める。
  -- **表単位の制約なので、列の定義を全部書き終えてから置く。**
  -- SQLite は列定義より前に表単位の制約が来ると、そこから先の列を
  -- 構文エラーにする（starts_on の直後に置いた最初の版がそれで通らなかった）
  CHECK (starts_on IS NULL OR due_on IS NULL OR starts_on <= due_on)
);

-- 一覧はイベント単位で全件引く（件数に上限を置くので、ページングはしない）。
CREATE INDEX idx_event_todo_event ON event_todo(event_id, sort_order);

-- 依存関係。**1種類だけ**: todo_id は depends_on_id が done になるまで着手できない。
--
-- 開始・終了の組み合わせ（SS / FF / SF）とラグは作らない。
--   - 種類が増えると、帯の間の線を見た人が「どの種類か」を線から読めない
--   - 「待ち」の判定が種類ごとに変わる。1種類なら述語は1つで済み、保存せず導出できる
--   - ラグ（3日空ける）は後続の starts_on を3日後に置けば表現できる。
--     同じことを2通りで書けるようにしない
--
-- 多対多にしているのは、「告知を出す」が「会場を押さえる」と「登壇者を決める」の
-- **両方**を待つのが普通だから。event_todo に depends_on_id を1列足す案だと、
-- この普通の形が偽の直列に潰れる。
--
-- 循環 (A→B→A) は**サーバーが書かせない**（辺を足すとき、逆向きの到達可能性を
-- BFS で見て弾く）。DB の制約では表現できない。
-- ただし読み側の走査は、万一循環が入っても必ず終わるように書くこと
-- （入口の検査は「正しい入力か」、走査の有限性は「どんな入力でも終わるか」で、別の話）。
CREATE TABLE event_todo_dep (
  -- 待つ側（後）
  todo_id       TEXT NOT NULL REFERENCES event_todo(id) ON DELETE CASCADE,
  -- 待たれる側（先）
  depends_on_id TEXT NOT NULL REFERENCES event_todo(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  -- 同じ辺を二重に持たせない
  PRIMARY KEY (todo_id, depends_on_id)
);

-- 「この仕事を待っているのは誰か」を引く向き（PRIMARY KEY は逆向きだけを賄う）。
-- 循環判定の BFS と、ガントの線を引くのに両向きが要る
CREATE INDEX idx_event_todo_dep_reverse ON event_todo_dep(depends_on_id);
