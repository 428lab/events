-- 公式鍵署名の kind:40 をイベントに束縛する (#221)。
-- /chat-channel/official が発行した kind:40 の id を控え、公式鍵署名イベントの
-- 登録は「このイベント向けに発行された id」と一致する場合のみ受理する
-- （別イベント向け・過去発行分の持ち込み防止。再発行で上書き）
ALTER TABLE event ADD COLUMN chat_channel_pending TEXT;
