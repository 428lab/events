-- 名札: 運営が人ごとに代わりの画像を設定する。オーナー依頼 2026-11-25
-- 「アイコンが出せない人は運営側で代わりの画像を個別にアップロードできるようにできる？」。
-- このイベントの名札（印刷・編集のプレビュー）だけで使う。本人のプロフィールのアイコンは変えない
-- （運営の素材であって本人の持ち物ではないため）。画像はイベントの名札素材 (event_card_asset) を使う。
-- 素材を消すときは、名札のデザインで使っている素材と同じく「使用中」として断る
-- （routes/cardDesignAssets.ts の削除。黙って差し替えが外れないようにする）。
CREATE TABLE event_card_member_image (
  event_id TEXT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id),
  FOREIGN KEY (asset_id, event_id) REFERENCES event_card_asset(id, event_id) ON DELETE CASCADE
);
CREATE INDEX event_card_member_image_asset ON event_card_member_image(event_id, asset_id);
