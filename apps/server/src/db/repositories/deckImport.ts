import { batch, one } from "../client.js";

export interface DeckImportReceipt {
  payload_sha256: string; deck_id: string; target_id: string | null;
  owner_id: string | null; slug: string | null;
}
export interface ImportWrite {
  ownerId: string; key: string; hash: string; id: string; slug: string;
  title: string; content: string; now: number;
}
export const deckImportRepo = {
  find(ownerId: string, key: string): Promise<DeckImportReceipt | null> {
    return one<DeckImportReceipt>(
      `SELECT r.payload_sha256, r.deck_id, d.id AS target_id, d.owner_id, d.slug
       FROM deck_import_receipt r LEFT JOIN deck d ON d.id = r.deck_id
       WHERE r.owner_id = ? AND r.import_key = ?`, ownerId, key,
    );
  },
  async insert(input: ImportWrite): Promise<number[]> {
    const { ownerId, key, hash, id, slug, title, content, now } = input;
    const dayStart = Math.floor(now / 86400000) * 86400000;
    return batch([
      {
        sql: `INSERT INTO deck_import_receipt (owner_id, import_key, payload_sha256, deck_id, created_at)
              SELECT ?, ?, ?, ?, ? WHERE
              (SELECT COUNT(*) FROM deck_import_receipt WHERE owner_id = ? AND created_at >= ? AND created_at < ?) < 100`,
        args: [ownerId, key, hash, id, now, ownerId, dayStart, dayStart + 86400000],
      },
      {
        sql: `INSERT INTO deck (id, slug, owner_id, title, content, created_at, updated_at)
              SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS
              (SELECT 1 FROM deck_import_receipt WHERE owner_id = ? AND import_key = ? AND deck_id = ?)`,
        args: [id, slug, ownerId, title, content, now, now, ownerId, key, id],
      },
    ]);
  },
};

/** D1 wraps SQLite errors; match only the named uniqueness constraints, never all DB errors. */
export function importUniqueConflict(error: unknown): "receipt" | "identity" | null {
  const messages: string[] = [];
  let current = error;
  for (let i = 0; current instanceof Error && i < 4; i++) {
    messages.push(current.message);
    current = current.cause;
  }
  const message = messages.join("\n");
  if (/UNIQUE constraint failed: deck_import_receipt\.owner_id, deck_import_receipt\.import_key(?:\s|:|$)/.test(message)) return "receipt";
  if (/UNIQUE constraint failed: (?:deck\.(?:id|slug)|deck_import_receipt\.deck_id)(?:\s|:|$)/.test(message)) return "identity";
  return null;
}
