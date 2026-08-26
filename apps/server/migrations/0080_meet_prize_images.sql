-- 景品に任意の画像 (#434)。R2 のオブジェクトキー（無ければ NULL＝画像なし）。
-- キーはアップロードごとに新しく振る（差し替えの取り違えと複製時の共倒れを防ぐ）
ALTER TABLE event_prize ADD COLUMN image_key TEXT;
