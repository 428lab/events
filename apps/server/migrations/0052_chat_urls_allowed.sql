-- チャットの参加者URL投稿許可 (#241)。既定オフ（スタッフのみURL投稿・リンク化）
ALTER TABLE event ADD COLUMN chat_urls_allowed INTEGER NOT NULL DEFAULT 0;
