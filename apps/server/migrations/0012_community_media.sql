-- コミュニティのアイコン/バナー画像（R2に1枚ずつ。更新時刻でキャッシュバスト）とリンク集
ALTER TABLE community ADD COLUMN icon_updated_at INTEGER;
ALTER TABLE community ADD COLUMN banner_updated_at INTEGER;
ALTER TABLE community ADD COLUMN links TEXT NOT NULL DEFAULT '[]';
