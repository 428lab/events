-- 連携先のアイコンを自前で保管する (#312)。
--
-- これまで user.avatar_url には連携先（Discord など）のURLをそのまま入れていた。
-- Discord のアイコンURLは画像ごとのハッシュを含むため、本人がアイコンを変えると
-- 旧URLが 404 になり、以後どの画面でもアイコンが出なくなっていた。
-- 加えて補完はアイコンが未設定のときだけ行っていたので、ログインし直しても直らない。
--
-- 対策は2つの組み合わせ。
--   1. ログインのたびに連携先から最新のアイコンを取り直す（lib/avatarStore.ts）
--   2. 画像そのものを R2 (avatars/{user_id}) に保管し、自分のドメインから配信する
-- どちらか片方では不十分（取り直すだけ → 次のログインまで 404 が残る／
-- 保管するだけ → 連携先で変えても古い画像が固定される）。
--
-- 保管に成功したら avatar_url を "/api/users/{id}/avatar?v={更新時刻}" に差し替える。
-- avatar_url は一覧・名札・カードなど数十箇所の SELECT が直接読んでいるため、
-- ここを自ドメインのURLにするのが最も影響範囲が小さく、取りこぼしも出ない。
-- 取得に失敗したときは既存の avatar_url（連携先のURL）をそのまま残す＝ログインは通る。

-- R2 に保管したアイコンの更新時刻(epoch ms)。NULL = 自前保管なし（＝配信もしない）。
-- 配信URLの ?v= と ETag に使い、変わったときだけクライアントが取り直すようにする
ALTER TABLE user ADD COLUMN avatar_image_updated_at INTEGER;

-- 配信時の Content-Type。許可リスト (lib/imageMime.ts) を通ったものだけが入る
ALTER TABLE user ADD COLUMN avatar_image_mime TEXT;

-- 保管中の画像バイト列の SHA-256(hex)。
-- 毎ログインで取り直すが、中身が同じなら R2 の書き込みも updated_at の更新もしない。
-- これが無いとログインのたびに ?v= が変わり、同じ画像を毎回ダウンロードさせてしまう。
-- （URL の同一性では判定できない。GitHub のようにアイコンを変えてもURLが変わらない
--   連携先があり、URLで判定すると変更に追従できなくなる）
ALTER TABLE user ADD COLUMN avatar_image_hash TEXT;

-- 取り込み元（連携先）のアイコンURL。
-- 保管に成功すると avatar_url は自ドメインのURLで上書きされるため、これが無いと
-- 元の連携先URLがどこにも残らない（identity 表にもアイコンURLの列は無い）。
-- その状態でこの機能を切り戻すと、配信ルートが消えてアイコンが全員 404 になり、
-- 旧コードは「未設定のときだけ補完」なので再ログインしても復旧できない。
-- ここに控えておけば UPDATE user SET avatar_url = avatar_source_url で戻せる。
ALTER TABLE user ADD COLUMN avatar_source_url TEXT;
