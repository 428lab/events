-- Keep successful import identities after deck deletion; only user deletion cascades.
CREATE TABLE deck_import_receipt (
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  import_key TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  deck_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, import_key)
);
CREATE INDEX idx_deck_import_receipt_owner_created
  ON deck_import_receipt(owner_id, created_at);
