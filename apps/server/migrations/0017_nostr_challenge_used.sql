-- Nostr ログインチャレンジの使用済み記録（リプレイ防止）
CREATE TABLE nostr_challenge_used (
  nonce TEXT PRIMARY KEY,
  used_at INTEGER NOT NULL
);
CREATE INDEX idx_nostr_challenge_used_at ON nostr_challenge_used(used_at);
