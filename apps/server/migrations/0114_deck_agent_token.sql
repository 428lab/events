-- docs/agent-deck-token.md: a 60-minute token that lets an AI agent create one deck
-- for the issuing user, then rewrite it and upload its images until expiry.
-- Only the SHA-256 of the token is stored. deck_id is set by the first write and
-- intentionally has no FK: if the user deletes the deck, later writes answer 410.
CREATE TABLE deck_agent_token (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  deck_id TEXT UNIQUE,
  write_count INTEGER NOT NULL DEFAULT 0,
  -- Nonce of the latest counted write; links the counter UPDATE to its deck write in one batch.
  last_write_id TEXT,
  image_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX idx_deck_agent_token_owner_created
  ON deck_agent_token(owner_id, created_at);
