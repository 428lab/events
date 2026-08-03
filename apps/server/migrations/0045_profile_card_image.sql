-- プロフィールカードPNGのR2キャッシュ更新時刻（OG画像のキャッシュバスター用）(#193)
ALTER TABLE user ADD COLUMN card_image_updated_at INTEGER;
